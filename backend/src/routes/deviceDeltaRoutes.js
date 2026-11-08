const express=require('express');
const crypto=require('node:crypto');
const pool=require('../db');
const adminAuth=require('../middleware/adminAuth');
const permission=require('../middleware/requirePermission');
const institutionAuth=require('../middleware/institutionAuth');
const {rateLimit}=require('express-rate-limit');
const {loadRootCa,signPayload}=require('../security/rootCA');
const codec=require('../services/deviceDeltaCodec');
const router=express.Router();
const enrollmentLimit=rateLimit({windowMs:60000,limit:30,standardHeaders:true,legacyHeaders:false});
router.use('/device/v2',rateLimit({windowMs:60000,limit:120,standardHeaders:true,legacyHeaders:false}));
function fail(res,error) {
 const codes={ROOT_CA_UNAVAILABLE:503,DEVICE_NOT_FOUND:403,DEVICE_NOT_ACTIVE:403,CERTIFICATE_EXPIRED:403,
  INVALID_SIGNATURE:403,CHALLENGE_EXPIRED:403,CHALLENGE_USED:409,DEVICE_ALREADY_ENROLLED:409,
  CURSOR_CONFLICT:409,KEY_EPOCH_MISMATCH:409};
 const status=codes[error.message] || (error.message.startsWith('INVALID_') || error.message==='UNRELATED_RECORD' || error.message==='INDEX_OVERFLOW'?400:error.code==='23505'?409:503);
 return res.status(status).json({ok:false,error:status===503?'DEVICE_SERVICE_UNAVAILABLE':status===409&&error.code==='23505'?'RECORD_CONFLICT':error.message});
}
router.post('/admin/v2/device-enrollment/challenges',adminAuth,permission('DEVICE_ENROLL'),enrollmentLimit,async(req,res)=>{
 try {
  const pub=req.body?.public_key;
  const id=codec.deviceId(pub);
  const institution=String(req.body?.institution_id || '');
  if(!institution || institution.length>128) return res.status(400).json({error:'INVALID_INSTITUTION'});
  const issuer=await pool.query("SELECT id FROM institutions WHERE id::text=$1 AND status='active'",[institution]);
  if(!issuer.rowCount) return res.status(404).json({error:'INSTITUTION_NOT_FOUND'});
  const challenge=crypto.randomBytes(32).toString('hex');
  const inserted=await pool.query(`INSERT INTO device_enrollment_challenges_v2
   (challenge,device_id,public_key,institution_id,expires_at,created_by)
   VALUES($1,$2,$3,$4,clock_timestamp()+interval '5 minutes',$5) RETURNING expires_at`,
   [challenge,id,pub,institution,String(req.admin.id)]);
  res.set('Cache-Control','no-store');
  return res.status(201).json({ok:true,device_id:id,challenge,expires_at:inserted.rows[0].expires_at,
   signing_payload:codec.enrollmentMessage(challenge,pub,institution).toString('hex')});
 } catch(error){return fail(res,error);}
});
router.post('/device/v2/enroll',enrollmentLimit,async(req,res)=>{
 let client;
 try {
  codec.hex(req.body?.challenge,32,'CHALLENGE');codec.hex(req.body?.signature,64,'SIGNATURE');
  const root=loadRootCa();
  client=await pool.connect();await client.query('BEGIN');
  const found=await client.query(`SELECT *,expires_at>clock_timestamp() AS fresh
   FROM device_enrollment_challenges_v2 WHERE challenge=$1 FOR UPDATE`,[req.body.challenge]);
  const challenge=found.rows[0];
  if(!challenge || !challenge.fresh) throw new Error('CHALLENGE_EXPIRED');
  const issuer=await client.query("SELECT 1 FROM institutions WHERE id::text=$1 AND status='active' FOR SHARE",[challenge.institution_id]);
  if(!issuer.rowCount) throw new Error('DEVICE_NOT_ACTIVE');
  if(!codec.verifySignature(codec.enrollmentMessage(challenge.challenge,challenge.public_key,challenge.institution_id),req.body.signature,challenge.public_key)) throw new Error('INVALID_SIGNATURE');
  const existing=await client.query(`SELECT *,expires_at>clock_timestamp() AS fresh FROM device_sync_registry_v2 WHERE device_id=$1 FOR UPDATE`,[challenge.device_id]);
  if(existing.rowCount) {
   const device=existing.rows[0];
   if(device.public_key!==challenge.public_key || device.institution_id!==challenge.institution_id || device.status!=='ACTIVE' || !device.fresh) throw new Error('DEVICE_ALREADY_ENROLLED');
   await client.query('UPDATE device_enrollment_challenges_v2 SET consumed_at=COALESCE(consumed_at,clock_timestamp()) WHERE challenge=$1',[challenge.challenge]);
   await client.query('COMMIT');res.set('Cache-Control','no-store');
   return res.json({ok:true,certificate:device.certificate,recovered:true});
  }
  if(challenge.consumed_at) throw new Error('CHALLENGE_USED');
  const issued=Math.floor(Date.now()/1000),expires=issued+365*86400;
  const legacyBody=Buffer.concat([Buffer.from(challenge.public_key,'hex'),Buffer.from(challenge.device_id,'hex')]);
  const signedBody=Buffer.concat([Buffer.from('TRATUM-CERT-V2\0'),legacyBody,codec.sha(Buffer.from(challenge.institution_id)),codec.uint(0,'EPOCH'),codec.uint(issued,'ISSUED'),codec.uint(expires,'EXPIRY')]);
  const certificate={version:2,device_id:challenge.device_id,institution_id:challenge.institution_id,key_epoch:0,
   issued_at:issued,expires_at:expires,public_key:challenge.public_key,
   signing_payload:signedBody.toString('hex'),signature:signPayload(signedBody,root.privateKey).toString('hex'),
   firmware_certificate:Buffer.concat([legacyBody,signPayload(legacyBody,root.privateKey)]).toString('hex')};
  await client.query(`INSERT INTO device_sync_registry_v2(device_id,public_key,institution_id,certificate,expires_at)
   VALUES($1,$2,$3,$4,to_timestamp($5))`,[challenge.device_id,challenge.public_key,challenge.institution_id,certificate,expires]);
  await client.query('UPDATE device_enrollment_challenges_v2 SET consumed_at=clock_timestamp() WHERE challenge=$1',[challenge.challenge]);
  await client.query("INSERT INTO device_provision_audit_v2(actor_id,action,device_id) VALUES($1,'ENROLLED',$2)",[challenge.created_by,challenge.device_id]);
  await client.query('COMMIT');
  res.set('Cache-Control','no-store');return res.status(201).json({ok:true,certificate});
 }catch(error){if(client) await client.query('ROLLBACK').catch(()=>{});return fail(res,error);}
 finally{client?.release();}
});
router.post('/device/v2/deltas',async(req,res)=>{
 let client;
 try {
  const encoded=codec.encodeDelta(req.body);
  codec.hex(req.body.signature,64,'SIGNATURE');
  client=await pool.connect();await client.query('BEGIN');
  // Serializes competing uploads and revocation for this device.
  const found=await client.query(`SELECT *,expires_at>clock_timestamp() AS fresh
   FROM device_sync_registry_v2 WHERE device_id=$1 FOR UPDATE`,[req.body.device_id]);
  const device=found.rows[0];
  if(!device) throw new Error('DEVICE_NOT_FOUND');
  if(device.status!=='ACTIVE') throw new Error('DEVICE_NOT_ACTIVE');
  if(!device.fresh) throw new Error('CERTIFICATE_EXPIRED');
  if(Number(device.key_epoch)!==req.body.key_epoch) throw new Error('KEY_EPOCH_MISMATCH');
  const issuer=await client.query("SELECT 1 FROM institutions WHERE id::text=$1 AND status='active' FOR SHARE",[device.institution_id]);
  if(!issuer.rowCount) throw new Error('DEVICE_NOT_ACTIVE');
  if(!codec.verifySignature(encoded.message,req.body.signature,device.public_key)) throw new Error('INVALID_SIGNATURE');
  const prior=await client.query('SELECT * FROM device_delta_batches_v2 WHERE batch_id=$1',[encoded.batchId]);
  if(prior.rowCount) {
   await client.query('COMMIT');
   return res.json({ok:true,status:'DUPLICATE',batch_id:encoded.batchId,next_index:Number(prior.rows[0].next_index),sync_root:prior.rows[0].sync_root,financial_finality:false});
  }
  if(Number(device.next_index)!==req.body.from_index || device.sync_root!==req.body.previous_root) throw new Error('CURSOR_CONFLICT');
  await client.query(`INSERT INTO device_delta_batches_v2(batch_id,device_id,institution_id,from_index,next_index,previous_root,sync_root,signed_payload,signature,certificate)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[encoded.batchId,device.device_id,device.institution_id,req.body.from_index,encoded.nextIndex,req.body.previous_root,req.body.sync_root,
   encoded.message,Buffer.from(req.body.signature,'hex'),device.certificate]);
  for(let i=0;i<encoded.records.length;i++) {
   const summary=encoded.summaries[i];
   await client.query(`INSERT INTO device_delta_records_v2
    (device_id,ledger_index,institution_id,batch_id,record_hash,sender_id,nonce,summary,raw_record)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[device.device_id,req.body.from_index+i,device.institution_id,encoded.batchId,
    codec.sha(encoded.records[i]).toString('hex'),summary.sender_id,summary.nonce,summary,encoded.records[i]]);
  }
  await client.query('UPDATE device_sync_registry_v2 SET next_index=$2,sync_root=$3 WHERE device_id=$1',[device.device_id,encoded.nextIndex,req.body.sync_root]);
  await require('../services/webhookDelivery').enqueue(client,device.institution_id,encoded.batchId,device.device_id);
  await client.query('COMMIT');
  res.set('Cache-Control','no-store');
  return res.status(202).json({ok:true,status:'EVIDENCE_RECORDED',batch_id:encoded.batchId,next_index:encoded.nextIndex,sync_root:req.body.sync_root,financial_finality:false});
 }catch(error){if(client) await client.query('ROLLBACK').catch(()=>{});return fail(res,error);}
 finally{client?.release();}
});
router.post('/admin/v2/devices/:deviceId/revoke',adminAuth,permission('DEVICE_ENROLL'),async(req,res)=>{
 let client;
 try {
  codec.hex(req.params.deviceId,8,'DEVICE_ID');
  client=await pool.connect();await client.query('BEGIN');
  const found=await client.query("UPDATE device_sync_registry_v2 SET status='REVOKED' WHERE device_id=$1 RETURNING device_id",[req.params.deviceId]);
  if(!found.rowCount) throw new Error('DEVICE_NOT_FOUND');
  await client.query("INSERT INTO device_provision_audit_v2(actor_id,action,device_id) VALUES($1,'REVOKED',$2)",[String(req.admin.id),req.params.deviceId]);
  await client.query('COMMIT');return res.json({ok:true,status:'REVOKED'});
 }catch(error){if(client) await client.query('ROLLBACK').catch(()=>{});return fail(res,error);}
 finally{client?.release();}
});
// Bank-facing reads are scoped by the stored API credential. No caller-supplied tenant.
router.get('/institution/v2/devices/:deviceId/deltas',institutionAuth,require('../middleware/institutionV2Signature'),async(req,res)=>{
 try {
  codec.hex(req.params.deviceId,8,'DEVICE_ID');
  const from=req.query.from_index===undefined?'0':req.query.from_index;
  if(typeof from!=='string' || !/^(0|[1-9][0-9]{0,9})$/.test(from) || Number(from)>0xffffffff) throw new Error('INVALID_INDEX');
  const device=await pool.query('SELECT next_index,sync_root,status FROM device_sync_registry_v2 WHERE device_id=$1 AND institution_id=$2',[req.params.deviceId,String(req.institution.id)]);
  if(!device.rowCount) return res.status(404).json({error:'DEVICE_NOT_FOUND'});
  const records=await pool.query(`SELECT ledger_index,batch_id,record_hash,summary FROM device_delta_records_v2
   WHERE device_id=$1 AND institution_id=$2 AND ledger_index>=$3 ORDER BY ledger_index LIMIT 100`,[req.params.deviceId,String(req.institution.id),from]);
  const items=records.rows.map(row=>({...row,ledger_index:Number(row.ledger_index)}));
  res.set('Cache-Control','no-store');
  return res.json({ok:true,device_id:req.params.deviceId,...device.rows[0],next_index:Number(device.rows[0].next_index),records:items,
   next_from_index:items.length?items[items.length-1].ledger_index+1:Number(from),financial_finality:false,
   verification:'DEVICE_SIGNED_UPLOAD; LEGACY_PAYMENT_SIGNATURE_CONTEXT_NOT_RECONSTRUCTED'});
 }catch(error){return fail(res,error);}
});
router.get('/institution/v2/devices/:deviceId/batches/:batchId',institutionAuth,require('../middleware/institutionV2Signature'),async(req,res)=>{
 try {
  codec.hex(req.params.deviceId,8,'DEVICE_ID');codec.hex(req.params.batchId,32,'BATCH_ID');
  const found=await pool.query(`SELECT device_id,institution_id,batch_id,signed_payload,signature,certificate,received_at
   FROM device_delta_batches_v2 WHERE device_id=$1 AND batch_id=$2 AND institution_id=$3`,[req.params.deviceId,req.params.batchId,String(req.institution.id)]);
  if(!found.rowCount)return res.status(404).json({error:'BATCH_NOT_FOUND'});
  const row=found.rows[0];res.set('Cache-Control','no-store');
  return res.json({ok:true,proof:{...row,signed_payload:row.signed_payload.toString('hex'),signature:row.signature.toString('hex')},financial_finality:false});
 }catch(error){return fail(res,error);}
});
module.exports=router;
