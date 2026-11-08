const crypto=require('node:crypto');
const codec=require('./deviceDeltaCodec');
const {loadRootCa,signPayload}=require('../security/rootCA');
const {assertLicense}=require('./fleetAccess');
async function currentEra(client,lock='SHARE') {
 const result=await client.query(`SELECT value FROM sync_state WHERE key='TRATUM_TRUST_ERA' FOR ${lock}`);
 if(!result.rowCount)throw new Error('TRUST_POLICY_UNAVAILABLE');
 const policy=JSON.parse(result.rows[0].value);codec.uint(policy.era_no,'ERA');return policy;
}
function transitionPayload(row) {
 return Buffer.concat([Buffer.from('TRATUM-TRUST-V3\0'),codec.hex(row.device_id,8,'DEVICE_ID'),codec.hex(row.challenge,32,'CHALLENGE'),
  codec.uint(Number(row.old_epoch),'OLD_EPOCH'),codec.uint(Number(row.new_epoch),'NEW_EPOCH'),Buffer.from([Number(row.old_slot),Number(row.new_slot)]),
  codec.uint(Number(row.era_no),'ERA'),codec.uint(Number(row.expected_index),'INDEX'),codec.hex(row.expected_root,32,'ROOT'),
  codec.hex(row.old_public_key,64,'OLD_KEY'),codec.hex(row.new_public_key,64,'NEW_KEY'),codec.sha(Buffer.from(String(row.institution_id))),
  codec.uint(Math.floor(new Date(row.expires_at).getTime()/1000),'EXPIRY')]);
}
function makeCertificate(device,era,epoch,slot) {
 const now=Math.floor(Date.now()/1000),root=loadRootCa();
 const cert={version:3,device_id:device.device_id,institution_id:device.institution_id,public_key:device.public_key,key_epoch:epoch,era_no:era,active_key_slot:slot,issued_at:now,expires_at:now+365*86400};
 const payload=require('./deviceCertificateV2').certificatePayload(cert);
 return {...cert,signing_payload:payload.toString('hex'),signature:signPayload(payload,root.privateKey).toString('hex')};
}
async function certificateRecord(client,cert) {
 const hash=codec.sha(Buffer.from(cert.signing_payload,'hex')).toString('hex');
 await client.query(`UPDATE certificate_records SET status='REPLACED',replaced_by=$2 WHERE lower(device_id)=$1 AND status='ACTIVE' AND certificate_hash<>$2`,[cert.device_id,hash]);
 const exists=await client.query('SELECT 1 FROM certificate_records WHERE lower(device_id)=$1 AND certificate_hash=$2',[cert.device_id,hash]);
 if(!exists.rowCount)await client.query(`INSERT INTO certificate_records(device_id,certificate_hash,signature,issued_at,expiry_at,public_key,issuer_id,certificate_body,root_ca_version)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[cert.device_id,hash,cert.signature,cert.issued_at,cert.expires_at,cert.public_key,cert.institution_id,cert,'APPLICATION_CA']);
 return hash;
}
async function mirrorEnrollment(client,device,cert) {
 const prior=await client.query('SELECT * FROM devices WHERE lower(device_id)=$1 FOR UPDATE',[device.device_id]);
 if(prior.rowCount && (prior.rows[0].public_key!==device.public_key || String(prior.rows[0].issuer_id)!==device.institution_id || prior.rows[0].status!=='ACTIVE'))throw new Error('LEGACY_IDENTITY_CONFLICT');
 if(!prior.rowCount)await client.query("INSERT INTO devices(device_id,public_key,issuer_id,status) VALUES($1,$2,$3,'ACTIVE')",[device.device_id,device.public_key,device.institution_id]);
 const hash=await certificateRecord(client,cert);
 const registry=await client.query('SELECT * FROM device_registry WHERE lower(device_id)=$1 FOR UPDATE',[device.device_id]);
 if(registry.rowCount && (registry.rows[0].status!=='ACTIVE' || String(registry.rows[0].issuer_id)!==device.institution_id))throw new Error('LEGACY_IDENTITY_CONFLICT');
 if(!registry.rowCount)await client.query(`INSERT INTO device_registry(device_id,issuer_id,certificate_hash,certificate_signature) VALUES($1,$2,$3,$4)`,[device.device_id,device.institution_id,hash,cert.signature]);
 const trust=await client.query('SELECT key_epoch FROM device_trust_state WHERE lower(device_id)=$1 FOR UPDATE',[device.device_id]);
 if(trust.rows.some(x=>Number(x.key_epoch)>0))throw new Error('LEGACY_IDENTITY_CONFLICT');
 if(!trust.rowCount)await client.query(`INSERT INTO device_trust_state(device_id,attestation_status,attested_public_key,key_epoch,era_no,active_key_slot,lifecycle_observed_at)
  VALUES($1,'UNVERIFIED',$2,0,0,0,NULL)`,[device.device_id,device.public_key]);
}
async function createTransition(client,deviceId,{new_public_key,kind},actor) {
 const policy=await currentEra(client);
 const result=await client.query("SELECT *,expires_at>clock_timestamp() AS fresh FROM device_sync_registry_v2 WHERE device_id=$1 FOR UPDATE",[deviceId]);
 const d=result.rows[0];if(!d || d.status!=='ACTIVE' || (!d.fresh && kind!=='RENEW'))throw new Error('DEVICE_NOT_ACTIVE');
 await assertLicense(client,d.institution_id);
 const rotate=kind==='ROTATE';if(!['ROTATE','ACK_ERA','RENEW'].includes(kind))throw new Error('INVALID_TRANSITION_KIND');
 if(rotate){codec.publicKey(new_public_key);if(new_public_key===d.public_key || Number(d.key_epoch)===0xffffffff)throw new Error('INVALID_NEW_KEY');}
 else {if(kind==='ACK_ERA' && policy.era_no<=Number(d.era_no))throw new Error('ERA_ALREADY_CURRENT');new_public_key=d.public_key;}
 const row={transition_id:crypto.randomUUID(),kind,device_id:deviceId,institution_id:d.institution_id,old_public_key:d.public_key,new_public_key,
  challenge:crypto.randomBytes(32).toString('hex'),old_epoch:Number(d.key_epoch),new_epoch:Number(d.key_epoch)+(rotate?1:0),old_slot:d.active_key_slot,new_slot:rotate?1-d.active_key_slot:d.active_key_slot,
  era_no:policy.era_no,expected_index:Number(d.next_index),expected_root:d.sync_root,expires_at:new Date(Math.floor(Date.now()/1000)*1000+300000)};
 const payload=transitionPayload(row);
 await client.query("UPDATE device_key_history SET transition_status='CANCELLED' WHERE lower(device_id)=$1 AND transition_status='PENDING'",[deviceId]);
 await client.query(`INSERT INTO device_key_history(device_id,old_public_key,new_public_key,rotated_by,transition_id,transition_status,challenge,old_epoch,new_epoch,old_slot,new_slot,era_no,expected_index,expected_root,expires_at,signed_payload,transition_kind)
  VALUES($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[deviceId,row.old_public_key,row.new_public_key,actor,row.transition_id,row.challenge,row.old_epoch,row.new_epoch,row.old_slot,row.new_slot,row.era_no,row.expected_index,row.expected_root,row.expires_at,payload,kind]);
 return {...row,signing_payload:payload.toString('hex')};
}
async function commitTransition(client,id,oldSignature,newSignature) {
 const policy=await currentEra(client);
 const lookup=await client.query('SELECT device_id,transition_kind FROM device_key_history WHERE transition_id=$1',[id]);
 if(!lookup.rowCount)throw new Error('TRANSITION_NOT_FOUND');
 const device=await client.query('SELECT *,expires_at>clock_timestamp() AS fresh FROM device_sync_registry_v2 WHERE device_id=$1 FOR UPDATE',[lookup.rows[0].device_id]);
 const d=device.rows[0];if(!d || d.status!=='ACTIVE' || (!d.fresh && lookup.rows[0].transition_kind!=='RENEW'))throw new Error('DEVICE_NOT_ACTIVE');
 await assertLicense(client,d.institution_id);
 const found=await client.query('SELECT *,expires_at>clock_timestamp() AS fresh FROM device_key_history WHERE transition_id=$1 FOR UPDATE',[id]);
 const row={...found.rows[0],institution_id:d.institution_id};
 if(!codec.verifySignature(row.signed_payload,oldSignature,row.old_public_key) || !codec.verifySignature(row.signed_payload,newSignature,row.new_public_key))throw new Error('INVALID_SIGNATURE');
 if(row.transition_status==='COMMITTED'){
  if(!d.fresh || row.certificate_body?.signature!==d.certificate?.signature || Number(row.certificate_body.era_no)!==policy.era_no)throw new Error('TRANSITION_SUPERSEDED');
  return {certificate:row.certificate_body,duplicate:true};
 }
 if(row.transition_status!=='PENDING' || !row.fresh)throw new Error('TRANSITION_EXPIRED_OR_CANCELLED');
 if(Number(row.era_no)!==policy.era_no)throw new Error('ERA_POLICY_CHANGED');
 if(d.public_key!==row.old_public_key || Number(d.key_epoch)!==Number(row.old_epoch) || d.active_key_slot!==row.old_slot || Number(d.next_index)!==Number(row.expected_index) || d.sync_root!==row.expected_root)throw new Error('TRANSITION_CHECKPOINT_CHANGED');
 const cert=makeCertificate({...d,public_key:row.new_public_key},Number(row.era_no),Number(row.new_epoch),row.new_slot);
 await client.query('UPDATE device_sync_registry_v2 SET public_key=$2,key_epoch=$3,era_no=$4,active_key_slot=$5,certificate=$6,expires_at=to_timestamp($7) WHERE device_id=$1',[d.device_id,cert.public_key,cert.key_epoch,cert.era_no,cert.active_key_slot,cert,cert.expires_at]);
 await client.query('UPDATE devices SET public_key=$2 WHERE lower(device_id)=$1',[d.device_id,cert.public_key]);
 await client.query(`UPDATE device_trust_state SET attestation_status='UNVERIFIED',attestation_token=NULL,token_expiry=NULL,
  attested_public_key=$2,key_epoch=$3,era_no=$4,active_key_slot=$5,lifecycle_observed_at=clock_timestamp(),updated_at=now() WHERE lower(device_id)=$1`,[d.device_id,cert.public_key,cert.key_epoch,cert.era_no,cert.active_key_slot]);
 const hash=await certificateRecord(client,cert);
 await client.query('UPDATE device_registry SET certificate_hash=$2,certificate_signature=$3,updated_at=now() WHERE lower(device_id)=$1',[d.device_id,hash,cert.signature]);
 await client.query(`UPDATE device_key_history SET transition_status='COMMITTED',rotated_at=now(),old_signature=$2,new_signature=$3,certificate_body=$4 WHERE transition_id=$1`,[id,oldSignature,newSignature,cert]);
 await client.query("INSERT INTO audit_log(actor_id,action,target_id,metadata) VALUES($1,'DEVICE_TRUST_TRANSITION',$2,$3)",[row.rotated_by,d.device_id,{transition_id:id,era_no:cert.era_no,key_epoch:cert.key_epoch,active_key_slot:cert.active_key_slot}]);
 return {certificate:cert,duplicate:false};
}
async function assertCurrentTrust(client,deviceId) {
 if(typeof deviceId!=='string' || !/^[a-fA-F0-9]{16}$/.test(deviceId))throw new Error('INVALID_DEVICE_ID');
 const id=deviceId.toLowerCase(),policy=await currentEra(client);
 const registry=await client.query('SELECT status,public_key,key_epoch,institution_id FROM device_sync_registry_v2 WHERE device_id=$1 FOR SHARE',[id]);
 if(registry.rowCount && registry.rows[0].status!=='ACTIVE')throw new Error('DEVICE_NOT_ACTIVE');
 const found=await client.query('SELECT * FROM device_trust_state WHERE lower(device_id)=$1 FOR SHARE',[id]);
 const state=found.rows[0];if(!state)throw new Error('DEVICE_NOT_ATTESTED');
 if(registry.rowCount){
  if(state.attested_public_key!==registry.rows[0].public_key || Number(state.key_epoch)!==Number(registry.rows[0].key_epoch))throw new Error('ATTESTED_KEY_MISMATCH');
  await assertLicense(client,registry.rows[0].institution_id,{requiredProduct:'OFFLINE_PAYMENTS'});
 }
 if(Number(state.era_no)!==policy.era_no)throw new Error('ERA_ACK_REQUIRED');
 if(state.attestation_status!=='VERIFIED' || Number(state.trust_score)<=0)throw new Error('DEVICE_UNTRUSTED');
 if(!state.token_expiry || Number(state.token_expiry)<=Date.now())throw new Error('ATTESTATION_EXPIRED');
 return state;
}
function statePayload(body) {
 if(!body || ![0,1].includes(body.active_key_slot) || typeof body.counter!=='string' || !/^(0|[1-9][0-9]{0,19})$/.test(body.counter) || BigInt(body.counter)>18446744073709551615n)throw new Error('INVALID_DEVICE_STATE');
 if(Object.keys(body).some(k=>!['device_id','key_epoch','era_no','active_key_slot','counter','timestamp','signature'].includes(k)))throw new Error('INVALID_DEVICE_STATE_FIELD');
 const counter=Buffer.alloc(8);counter.writeBigUInt64LE(BigInt(body.counter));
 return Buffer.concat([Buffer.from('TRATUM-STATE-V3\0'),codec.hex(body.device_id,8,'DEVICE_ID'),codec.uint(body.key_epoch,'EPOCH'),codec.uint(body.era_no,'ERA'),Buffer.from([body.active_key_slot]),counter,codec.uint(body.timestamp,'TIMESTAMP')]);
}
async function recordState(client,body) {
 const payload=statePayload(body);if(Math.abs(Date.now()/1000-body.timestamp)>300)throw new Error('INVALID_STATE_TIMESTAMP');
 await currentEra(client);
 const found=await client.query('SELECT *,expires_at>clock_timestamp() AS fresh FROM device_sync_registry_v2 WHERE device_id=$1 FOR UPDATE',[body.device_id]);
 const d=found.rows[0];if(!d || d.status!=='ACTIVE' || !d.fresh)throw new Error('DEVICE_NOT_ACTIVE');
 await assertLicense(client,d.institution_id,{requiredProduct:'TELEMETRY'});
 if(!codec.verifySignature(payload,body.signature,d.public_key))throw new Error('INVALID_SIGNATURE');
 if(body.key_epoch!==Number(d.key_epoch) || body.era_no!==Number(d.era_no) || body.active_key_slot!==d.active_key_slot)throw new Error('STATE_TRANSITION_REQUIRED');
 const trust=await client.query('SELECT * FROM device_trust_state WHERE lower(device_id)=$1 FOR UPDATE',[body.device_id]);
 if(!trust.rowCount)throw new Error('TRUST_STATE_NOT_FOUND');
 const previous=trust.rows[0],hash=codec.sha(payload).toString('hex');
 if(Number(previous.last_state_epoch)===body.key_epoch && previous.last_state_counter!==null){
  if(BigInt(body.counter)<BigInt(previous.last_state_counter))throw new Error('STATE_COUNTER_REPLAY');
  if(body.counter===previous.last_state_counter){if(hash!==previous.last_state_hash)throw new Error('STATE_COUNTER_CONFLICT');return {duplicate:true,received_at:previous.last_state_received_at};}
 }
 const updated=await client.query(`UPDATE device_trust_state SET last_state_epoch=$2,last_state_counter=$3,last_state_hash=$4,
  last_state_body=$5,last_state_received_at=clock_timestamp(),lifecycle_observed_at=clock_timestamp(),updated_at=now()
  WHERE lower(device_id)=$1 RETURNING last_state_received_at`,[body.device_id,body.key_epoch,body.counter,hash,body]);
 await client.query('UPDATE devices SET last_seen=now() WHERE lower(device_id)=$1',[body.device_id]);
 return {duplicate:false,received_at:updated.rows[0].last_state_received_at};
}
module.exports={currentEra,transitionPayload,mirrorEnrollment,createTransition,commitTransition,assertCurrentTrust,statePayload,recordState};
