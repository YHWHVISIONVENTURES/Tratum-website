const router=require('express').Router();
const crypto=require('node:crypto');
const pool=require('../db');
const institutionAuth=require('../middleware/institutionAuth');
const {validateFeature,fingerprint}=require('../services/deviceFeatureValidation');
const {rateLimit}=require('express-rate-limit');
router.use('/institution/v1/device-features', institutionAuth,
 rateLimit({windowMs:60000,limit:60,standardHeaders:true,legacyHeaders:false}));
router.post('/institution/v1/device-features/:kind',async(req,res)=>{
 const kind=req.params.kind;
 let payload;
 const key=req.get('Idempotency-Key');
 if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) return res.status(400).json({error:'INVALID_IDEMPOTENCY_KEY'});
 try { payload=validateFeature(kind,req.body); }
 catch(error) { return res.status(400).json({error:error.message}); }
 const institution=String(req.institution.id);
 const hash=fingerprint(kind,payload);
 try {
  // The API credential determines the tenant; the caller cannot choose it.
  const device=await pool.query("SELECT 1 FROM device_sync_registry_v2 WHERE device_id=$1 AND institution_id=$2 AND status='ACTIVE' AND expires_at>clock_timestamp()",[payload.device_id,institution]);
  if (!device.rows.length) return res.status(404).json({error:'DEVICE_NOT_FOUND'});
  const inserted=await pool.query(`INSERT INTO device_feature_requests
   (id,institution_id,device_id,idempotency_key,request_hash,kind,payload)
   VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(institution_id,idempotency_key) DO NOTHING RETURNING id,status,created_at`,
   [crypto.randomUUID(),institution,payload.device_id,key,hash,kind,payload]);
  let request=inserted.rows[0];
  if (!request) {
   const prior=await pool.query('SELECT id,status,created_at,request_hash FROM device_feature_requests WHERE institution_id=$1 AND idempotency_key=$2',[institution,key]);
   if (!prior.rows[0] || prior.rows[0].request_hash!==hash) return res.status(409).json({error:'IDEMPOTENCY_CONFLICT'});
   const {request_hash,...publicRequest}=prior.rows[0]; request=publicRequest;
  }
  res.set('Cache-Control','no-store');
  return res.status(inserted.rows.length?202:200).json({ok:true,request,
   funds_moved:false,delivery_confirmed:false,
   message:'Request recorded. Customer authorization, funding and provider delivery are not connected.'});
 } catch { return res.status(503).json({error:'FEATURE_REQUEST_UNAVAILABLE'}); }
});
module.exports=router;
