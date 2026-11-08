const router=require('express').Router();
const pool=require('../db');
const auth=require('../middleware/adminAuth');
const permission=require('../middleware/requirePermission');
const lifecycle=require('../services/deviceLifecycle');
const {rateLimit}=require('express-rate-limit');
function failure(res,error) {
 const message=error.message || '';
 const expected=['ERA_CONFLICT','ERA_POLICY_CHANGED','ERA_ALREADY_CURRENT','TRANSITION_EXPIRED_OR_CANCELLED','TRANSITION_CHECKPOINT_CHANGED','TRANSITION_SUPERSEDED','STATE_COUNTER_REPLAY','STATE_COUNTER_CONFLICT','STATE_TRANSITION_REQUIRED','TRUST_STATE_NOT_FOUND'];
 const status=message.startsWith('INVALID_')?400:['DEVICE_NOT_ACTIVE','ENTERPRISE_LICENSE_INACTIVE','FEATURE_NOT_LICENSED'].includes(message)?403:message==='TRANSITION_NOT_FOUND'?404:expected.includes(message)?409:503;
 return res.status(status).json({ok:false,error:status===503?'TRUST_SERVICE_UNAVAILABLE':message});
}
async function transaction(work,res) {let c;try{c=await pool.connect();await c.query('BEGIN');const result=await work(c);await c.query('COMMIT');res.set('Cache-Control','no-store');return res.json({ok:true,...result});}catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});return failure(res,e);}finally{c?.release();}}
router.get('/admin/v3/trust/era',auth,permission('OPS_VIEW'),async(req,res,next)=>{try{const policy=await lifecycle.currentEra(pool);res.json({ok:true,policy});}catch(e){next(e);}});
router.post('/admin/v3/trust/era',auth,permission('TRUST_MANAGE'),async(req,res)=>transaction(async c=>{
 const {expected_era,reason}=req.body || {};
 if(!Number.isInteger(expected_era) || expected_era<0 || typeof reason!=='string' || reason.trim().length<10 || reason.length>1000)throw new Error('INVALID_ERA_ADVANCE');
 const previous=await lifecycle.currentEra(c,'UPDATE');
 if(previous.era_no!==expected_era || expected_era>=0xffffffff)throw new Error('ERA_CONFLICT');
 const policy={era_no:expected_era+1,reason:reason.trim(),issued_at:Math.floor(Date.now()/1000)};
 const payload=Buffer.from(JSON.stringify({domain:'TRATUM-ERA-POLICY-V3',...policy}));
 const {loadRootCa,signPayload}=require('../security/rootCA');
 policy.signing_payload=payload.toString('hex');policy.signature=signPayload(payload,loadRootCa().privateKey).toString('hex');
 await c.query("UPDATE sync_state SET value=$1,updated_at=now() WHERE key='TRATUM_TRUST_ERA'",[JSON.stringify(policy)]);
 await c.query("INSERT INTO audit_log(actor_id,action,target_id,metadata) VALUES($1,'TRUST_ERA_ADVANCED','NETWORK',$2)",[String(req.admin.id),{previous_era:expected_era,...policy}]);
 return {policy};
},res));
router.post('/admin/v3/devices/:deviceId/transitions',auth,permission('TRUST_MANAGE'),async(req,res)=>transaction(async c=>{
 if(!/^[a-f0-9]{16}$/.test(req.params.deviceId))throw new Error('INVALID_DEVICE_ID');
 return {transition:await lifecycle.createTransition(c,req.params.deviceId,req.body || {},String(req.admin.id))};
},res));
router.post('/device/v3/trust/transitions/:transitionId/commit',rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false}),async(req,res)=>transaction(async c=>{
 if(!/^[a-f0-9-]{36}$/.test(req.params.transitionId))throw new Error('INVALID_TRANSITION_ID');
 return lifecycle.commitTransition(c,req.params.transitionId,req.body?.old_signature,req.body?.new_signature);
},res));
router.get('/device/v3/trust/era',async(req,res,next)=>{try{res.set('Cache-Control','no-store');res.json({ok:true,policy:await lifecycle.currentEra(pool)});}catch(e){next(e);}});
router.post('/device/v3/state',rateLimit({windowMs:60000,limit:60,standardHeaders:true,legacyHeaders:false}),async(req,res)=>transaction(c=>lifecycle.recordState(c,req.body),res));
module.exports=router;
