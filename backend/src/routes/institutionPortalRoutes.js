const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const pool = require('../db');
const adminAuth = require('../middleware/adminAuth');
const permission = require('../middleware/requirePermission');
const router = express.Router();
const cookieName = 'tratum_bank_session';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const loginLimit = rateLimit({ windowMs: 15*60*1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const emailValid = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const passwordValid = value => typeof value === 'string' && value.length >= 14 && Buffer.byteLength(value) <= 72;
function cookieOptions() { return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/portal' }; }
function token(req) {
 const match = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='));
 const value = match?.slice(cookieName.length+1);
 return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}
function sameOrigin(req,res,next) {
 const configured = process.env.PORTAL_ORIGIN;
 // Browser mutations require an explicitly configured origin, including login.
 if (!configured || req.headers.origin !== configured) return res.status(403).json({error:'ORIGIN_NOT_ALLOWED'});
 next();
}
async function session(req,res,next) {
 try {
  const value=token(req);
  if(!value) return res.status(401).json({error:'LOGIN_REQUIRED'});
  const found=await pool.query(`SELECT u.id,u.email,u.institution_id,u.access_role,i.name,i.type
   FROM institution_sessions s JOIN institution_users u ON u.id=s.user_id
   JOIN institutions i ON i.institution_id::text=u.institution_id
   WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp()
    AND u.status='ACTIVE' AND i.status='active'`,[digest(value)]);
  if(!found.rowCount) return res.status(401).json({error:'LOGIN_REQUIRED'});
  try {await require('../services/fleetAccess').assertLicense(pool,found.rows[0].institution_id);}catch{return res.status(403).json({error:'INSTITUTION_ACCESS_INACTIVE'});}
  req.bankUser=found.rows[0]; res.set('Cache-Control','no-store'); next();
 } catch(error) { next(error); }
}
router.post('/admin/v2/institutions/:institutionId/users',adminAuth,permission('INSTITUTIONS_MANAGE'),async(req,res,next)=>{
 try {
  const {email,password,access_role='VIEWER'}=req.body || {};
  if(!['VIEWER','FLEET_OPERATOR','SUPERVISOR'].includes(access_role))return res.status(400).json({error:'INVALID_ACCESS_ROLE'});
  if(!emailValid(email) || !passwordValid(password)) return res.status(400).json({error:'VALID_EMAIL_AND_14_TO_72_BYTE_PASSWORD_REQUIRED'});
  const hash=await bcrypt.hash(password,12);
  const found=await pool.query(`INSERT INTO institution_users(institution_id,email,password_hash,access_role)
   SELECT institution_id::text,$2,$3,$4 FROM institutions WHERE institution_id::text=$1 AND status='active' AND ($4<>'SUPERVISOR' OR type='CENTRAL_BANK')
   RETURNING id,institution_id,email,status,access_role`,[req.params.institutionId,email.toLowerCase(),hash,access_role]);
  if(!found.rowCount) return res.status(404).json({error:'INSTITUTION_NOT_FOUND'});
  res.set('Cache-Control','no-store'); res.status(201).json({ok:true,user:found.rows[0]});
 } catch(error) { if(error.code==='23505') return res.status(409).json({error:'USER_EXISTS'}); next(error); }
});
router.patch('/admin/v2/institution-users/:userId/disable',adminAuth,permission('INSTITUTIONS_MANAGE'),async(req,res,next)=>{
 try {
  const found=await pool.query("UPDATE institution_users SET status='DISABLED' WHERE id::text=$1 RETURNING id",[req.params.userId]);
  if(!found.rowCount) return res.status(404).json({error:'USER_NOT_FOUND'});
  res.json({ok:true});
 } catch(error) { next(error); }
});
router.post('/portal/v2/auth/login',sameOrigin,loginLimit,async(req,res,next)=>{
 try {
  const {institution_id,email,password}=req.body || {};
  if(typeof institution_id!=='string' || institution_id.length>128 || !emailValid(email) || !passwordValid(password)) return res.status(401).json({error:'INVALID_LOGIN'});
  const found=await pool.query(`SELECT u.* FROM institution_users u JOIN institutions i ON i.institution_id::text=u.institution_id
   WHERE u.institution_id=$1 AND u.email=$2 AND u.status='ACTIVE' AND i.status='active'`,[institution_id,email.toLowerCase()]);
  // A real bcrypt hash makes unknown-user requests take the same expensive path.
  const fallback='$2b$12$C6UzMDM.H6dfI/f/IKcEe.5NhJkYIX/FWzlnEGB4wT0zbYKe0gA9u';
  const valid=await bcrypt.compare(password,found.rows[0]?.password_hash || fallback);
  if(!found.rowCount || !valid) return res.status(401).json({error:'INVALID_LOGIN'});
  try{await require('../services/fleetAccess').assertLicense(pool,institution_id);}catch{return res.status(403).json({error:'INSTITUTION_ACCESS_INACTIVE'});}
  const raw=crypto.randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO institution_sessions(token_hash,user_id,expires_at)
   VALUES($1,$2,clock_timestamp()+interval '8 hours')`,[digest(raw),found.rows[0].id]);
  // Rotate an existing browser session on successful login.
  const previous=token(req); if(previous) await pool.query('DELETE FROM institution_sessions WHERE token_hash=$1',[digest(previous)]);
  res.cookie(cookieName,raw,{...cookieOptions(),maxAge:8*60*60*1000});
  res.set('Cache-Control','no-store'); res.json({ok:true});
 } catch(error) { next(error); }
});
router.post('/portal/v2/auth/logout',sameOrigin,async(req,res,next)=>{
 try {
  const raw=token(req); if(raw) await pool.query('DELETE FROM institution_sessions WHERE token_hash=$1',[digest(raw)]);
  res.clearCookie(cookieName,cookieOptions());res.set('Cache-Control','no-store');res.json({ok:true});
 } catch(error) { next(error); }
});
router.use('/portal/v2',session);
router.get('/portal/v2/me',(req,res)=>res.json({ok:true,user:req.bankUser}));
router.get('/portal/v2/webhooks',async(req,res,next)=>{
 try {
  const tenant=String(req.bankUser.institution_id);
  const [endpoint,events]=await Promise.all([
   pool.query('SELECT url,enabled FROM institution_webhook_endpoints WHERE institution_id=$1',[tenant]),
   pool.query(`SELECT event_id,status,attempts,last_http_status,created_at,delivered_at FROM institution_webhook_outbox
    WHERE institution_id=$1 ORDER BY created_at DESC,event_id LIMIT 100`,[tenant])
  ]);
  res.json({ok:true,endpoint:endpoint.rows[0] || null,events:events.rows});
 }catch(error){next(error);}
});
router.get('/portal/v2/overview',async(req,res,next)=>{
 try {
  const institution=String(req.bankUser.institution_id);
  const [devices,batches,records]=await Promise.all([
   pool.query(`SELECT count(*) AS total,count(*) FILTER(WHERE status='ACTIVE' AND expires_at>now()) AS active
    FROM device_sync_registry_v2 WHERE institution_id=$1`,[institution]),
   pool.query('SELECT count(*) AS total,max(received_at) AS latest FROM device_delta_batches_v2 WHERE institution_id=$1',[institution]),
   pool.query('SELECT count(*) AS total FROM device_delta_records_v2 WHERE institution_id=$1',[institution])
  ]);
  res.json({ok:true,institution:req.bankUser,devices:devices.rows[0],batches:batches.rows[0],records:records.rows[0],financial_finality:false});
 } catch(error) { next(error); }
});
router.get('/portal/v2/devices',async(req,res,next)=>{
 try {
  const after=req.query.after || '';
  if(typeof after!=='string' || (after && !/^[a-f0-9]{16}$/.test(after))) return res.status(400).json({error:'INVALID_CURSOR'});
  const found=await pool.query(`SELECT device_id,status,key_epoch,expires_at,next_index,sync_root
   FROM device_sync_registry_v2 WHERE institution_id=$1 AND device_id>$2 ORDER BY device_id LIMIT 100`,[String(req.bankUser.institution_id),after]);
  res.json({ok:true,devices:found.rows,next_after:found.rows.length===100?found.rows[99].device_id:null});
 } catch(error) { next(error); }
});
router.get('/portal/v2/devices/:deviceId/batches',async(req,res,next)=>{
 try {
  if(!/^[a-f0-9]{16}$/.test(req.params.deviceId)) return res.status(400).json({error:'INVALID_DEVICE_ID'});
  const tenant=String(req.bankUser.institution_id);
  const device=await pool.query('SELECT device_id FROM device_sync_registry_v2 WHERE device_id=$1 AND institution_id=$2',[req.params.deviceId,tenant]);
  if(!device.rowCount) return res.status(404).json({error:'DEVICE_NOT_FOUND'});
  const found=await pool.query(`SELECT batch_id,from_index,next_index,received_at,sync_root
   FROM device_delta_batches_v2 WHERE device_id=$1 AND institution_id=$2 ORDER BY from_index DESC LIMIT 100`,[req.params.deviceId,tenant]);
  res.json({ok:true,batches:found.rows,financial_finality:false});
 } catch(error) { next(error); }
});
module.exports=router;
module.exports.session=session;
module.exports.sameOrigin=sameOrigin;
