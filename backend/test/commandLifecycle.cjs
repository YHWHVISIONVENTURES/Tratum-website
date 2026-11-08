const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
module.exports=async function run(ctx){
 const {pool,base,token,bankA,bankB,cert,device,codec,root,call,browserGet,browserLogin,cookieA,bankPassword,envelope,record,second,nativeExecutable,first}=ctx;
 async function request(route,body,{method='POST',cookie,admin=true}={}){
  const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Origin:process.env.PORTAL_ORIGIN,...(admin?{Authorization:'Bearer '+token}:{}),...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
 }
 const command=await fetch(base+'/admin/v3/command',{headers:{Authorization:'Bearer '+token}});assert.equal(command.status,200);
 const dashboard=await command.json();assert.equal(dashboard.scope.kind,'TRATUM');assert.equal(dashboard.summary.total,'1');assert.ok(dashboard.engines.length>=10);
 assert.equal((await browserGet('/portal/v3/command')).body.summary.total,'1');
 assert.equal((await browserGet('/portal/v3/command?institution_id='+bankB.body.institution.id)).status,403);
 const enterprise=await call('/admin/institutions',{name:'Enterprise fleet test',type:'ENTERPRISE',country_code:'NG'},token);assert.equal(enterprise.status,200);
 const entId=String(enterprise.body.institution.id),license={status:'ACTIVE',node_limit:1,expires_at:new Date(Date.now()+86400000).toISOString(),products:['FLEET','API','TELEMETRY']};
 assert.equal((await request('/admin/v3/institutions/'+entId+'/license',license,{method:'PUT'})).status,200);
 const entUser=await call('/admin/v2/institutions/'+entId+'/users',{email:'fleet@enterprise.test',password:bankPassword,access_role:'FLEET_OPERATOR'},token);assert.equal(entUser.status,201);
 async function enrollFor(bank){const pair=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'}),pub=Buffer.concat([Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('hex');const challenge=await call('/admin/v2/device-enrollment/challenges',{public_key:pub,institution_id:String(bank.body.institution.id)},token);assert.equal(challenge.status,201);const signature=crypto.sign('sha256',Buffer.from(challenge.body.signing_payload,'hex'),{key:pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('hex');return {pair,challenge,result:await call('/device/v2/enroll',{challenge:challenge.body.challenge,signature})};}
 const entDevice=await enrollFor(enterprise);assert.equal(entDevice.result.status,201);
 assert.equal((await enrollFor(enterprise)).result.status,403,'license limits cannot be bypassed with another enrollment challenge');
 const entLogin=await browserLogin(enterprise,'fleet@enterprise.test');assert.equal(entLogin.status,200);const entCookie=entLogin.headers.get('set-cookie').split(';')[0];
 const enterpriseView=await browserGet('/portal/v3/command',entCookie);assert.equal(enterpriseView.status,200);assert.equal(enterpriseView.body.scope.kind,'ENTERPRISE');assert.equal(enterpriseView.body.summary.total,'1');assert.equal(enterpriseView.body.devices[0].device_id,entDevice.result.body.certificate.device_id);
 assert.equal((await browserGet('/portal/v3/command?institution_id='+bankA.body.institution.id,entCookie)).status,403);
 assert.equal((await request('/portal/v3/devices/'+cert.device_id+'/suspend',{}, {cookie:entCookie,admin:false})).status,404);
 assert.equal((await request('/portal/v3/devices/'+entDevice.result.body.certificate.device_id+'/suspend',{}, {cookie:entCookie,admin:false})).status,200);
 assert.equal((await request('/portal/v3/devices/'+entDevice.result.body.certificate.device_id+'/suspend',{}, {cookie:entCookie,admin:false})).status,200);
 const audits=await pool.query("SELECT count(*) FROM audit_log WHERE action='FLEET_DEVICE_SUSPENDED'");assert.equal(audits.rows[0].count,'1');
 assert.equal((await request('/portal/v3/devices/'+cert.device_id+'/suspend',{}, {cookie:cookieA,admin:false})).status,403);
 // Fleet assignment does not change a node's issuing bank or reveal that bank's wider workspace.
 assert.equal((await request('/admin/v3/devices/'+cert.device_id+'/fleet',{enterprise_id:'enterprise_'+entId,can_suspend:false},{method:'PUT'})).status,409);
 assert.equal((await request('/admin/v3/institutions/'+entId+'/license',{...license,node_limit:2},{method:'PUT'})).status,200);
 assert.equal((await request('/admin/v3/devices/'+cert.device_id+'/fleet',{enterprise_id:'enterprise_'+entId,can_suspend:false},{method:'PUT'})).status,200);
 const assigned=await browserGet('/portal/v3/command',entCookie);assert.equal(assigned.body.summary.total,'2');
 assert.ok(assigned.body.devices.some(d=>d.device_id===cert.device_id));assert.equal(assigned.body.institutions.length,1);
 assert.equal((await browserGet('/portal/v3/command')).body.summary.total,'1');
 assert.equal((await request('/portal/v3/devices/'+cert.device_id+'/suspend',{}, {cookie:entCookie,admin:false})).status,404,'viewing a delegated fleet does not imply permission to suspend issuer trust');
 const central=await call('/admin/institutions',{name:'Central bank test',type:'CENTRAL_BANK',country_code:'NG'},token);assert.equal(central.status,200);
 const centralId=central.body.institution.id;
 assert.equal((await request('/admin/v3/institutions/'+centralId+'/supervision',{country_code:'NG'},{method:'PUT'})).status,200);
 assert.equal((await call('/admin/v2/institutions/'+centralId+'/users',{email:'supervisor@central.test',password:bankPassword,access_role:'SUPERVISOR'},token)).status,201);
 const centralLogin=await browserLogin(central,'supervisor@central.test');assert.equal(centralLogin.status,200);const centralCookie=centralLogin.headers.get('set-cookie').split(';')[0];
 const supervision=await browserGet('/portal/v3/command',centralCookie);assert.equal(supervision.status,200);assert.equal(supervision.body.scope.kind,'SUPERVISORY');
 assert.ok(supervision.body.institutions.some(i=>String(i.id)===String(bankA.body.institution.id)));assert.ok(!supervision.body.institutions.some(i=>String(i.id)===String(bankB.body.institution.id)));
 assert.equal((await browserGet('/portal/v3/command?institution_id='+bankB.body.institution.id,centralCookie)).status,403);
 assert.equal((await request('/portal/v3/devices/'+cert.device_id+'/suspend',{}, {cookie:centralCookie,admin:false})).status,403);
 assert.equal((await request('/admin/v3/institutions/'+entId+'/license',{...license,node_limit:2,products:['API']},{method:'PUT'})).status,200);
 assert.equal((await browserGet('/portal/v3/command',entCookie)).status,403,'a fleet role cannot bypass the licensed product scope');
 assert.equal((await request('/admin/v3/institutions/'+entId+'/license',{...license,status:'SUSPENDED'},{method:'PUT'})).status,200);
 assert.equal((await browserGet('/portal/v3/command',entCookie)).status,403);
 // Transition proofs bind both keys, the stable identity, checkpoint, slot and network era.
 const next=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=next.publicKey.export({format:'jwk'}),nextPub=Buffer.concat([Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('hex');
 function sign(pair,payload){return crypto.sign('sha256',Buffer.from(payload,'hex'),{key:pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('hex');}
 async function challenge(kind='ROTATE'){const r=await call('/admin/v3/devices/'+cert.device_id+'/transitions',{kind,new_public_key:kind==='ROTATE'?nextPub:undefined},token);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.transition;}
 async function commit(t,old=device,newKey=next){return call('/device/v3/trust/transitions/'+t.transition_id+'/commit',{old_signature:sign(old,t.signing_payload),new_signature:sign(newKey,t.signing_payload)});}
 const stale=await challenge();
 const third=envelope([record(3n)],2,second.sync_root);assert.equal((await call('/device/v2/deltas',third)).status,202);
 assert.equal((await commit(stale)).status,409,'an intervening upload invalidates the rotation checkpoint');
 const expired=await challenge();await pool.query("UPDATE device_key_history SET expires_at=now()-interval '1 second' WHERE transition_id=$1",[expired.transition_id]);assert.equal((await commit(expired)).status,409);
 const rotation=await challenge();
 const native=execFileSync(nativeExecutable,['--transition',rotation.device_id,rotation.challenge,String(rotation.old_epoch),String(rotation.new_epoch),String(rotation.old_slot),String(rotation.new_slot),String(rotation.era_no),String(rotation.expected_index),rotation.expected_root,rotation.old_public_key,rotation.new_public_key,codec.sha(Buffer.from(rotation.institution_id)).toString('hex'),String(Math.floor(new Date(rotation.expires_at).getTime()/1000))],{encoding:'utf8'}).trim();
 assert.equal(native,rotation.signing_payload,'native trust-transition message must match the backend byte for byte');
 assert.equal((await call('/device/v3/trust/transitions/'+rotation.transition_id+'/commit',{old_signature:'00'.repeat(64),new_signature:sign(next,rotation.signing_payload)})).status,400);
 const [committed,retry]=await Promise.all([commit(rotation),commit(rotation)]);assert.equal(committed.status,200,JSON.stringify(committed.body));assert.equal(retry.status,200);
 assert.equal(committed.body.certificate.device_id,cert.device_id);assert.equal(committed.body.certificate.key_epoch,1);assert.equal(committed.body.certificate.active_key_slot,1);assert.deepEqual(committed.body.certificate,retry.body.certificate);
 assert.ok(require('../src/services/deviceCertificateV2').verifyCertificate(committed.body.certificate,root.publicKey));
 const history=await pool.query("SELECT count(*) FROM device_key_history WHERE transition_status='COMMITTED'");assert.equal(history.rows[0].count,'1');
 const mirrored=await pool.query('SELECT public_key FROM devices WHERE device_id=$1',[cert.device_id]);assert.equal(mirrored.rows[0].public_key,nextPub);
 const trust=await pool.query('SELECT * FROM device_trust_state WHERE device_id=$1',[cert.device_id]);assert.equal(trust.rows[0].attestation_status,'UNVERIFIED');assert.equal(trust.rows[0].token_expiry,null);
 const fourth={...envelope([record(4n)],3,third.sync_root),key_epoch:1};fourth.signature=sign(next,codec.encodeDelta(fourth).message.toString('hex'));assert.equal((await call('/device/v2/deltas',fourth)).status,202);
 const {assertCurrentTrust}=require('../src/services/deviceLifecycle');await assert.rejects(assertCurrentTrust(pool,cert.device_id),/DEVICE_UNTRUSTED/);
 await pool.query("UPDATE device_trust_state SET attestation_status='VERIFIED',token_expiry=$2 WHERE device_id=$1",[cert.device_id,String(Date.now()+60000)]);await assertCurrentTrust(pool,cert.device_id);
 const policy=await call('/admin/v3/trust/era',{expected_era:0,reason:'Controlled integration test era transition'},token);assert.equal(policy.status,200);assert.equal(policy.body.policy.era_no,1);
 assert.equal((await call('/admin/v3/trust/era',{expected_era:0,reason:'Repeated compare-and-set policy update'},token)).status,409);
 assert.equal((await call('/device/v2/deltas',fourth)).status,409);await assert.rejects(assertCurrentTrust(pool,cert.device_id),/ERA_ACK_REQUIRED/);
 const ack=await challenge('ACK_ERA');const acknowledged=await commit(ack,next,next);assert.equal(acknowledged.status,200);assert.equal(acknowledged.body.certificate.era_no,1);assert.equal(acknowledged.body.certificate.key_epoch,1);
 assert.equal((await commit(rotation)).status,409,'superseded certificates must not be returned as current transition receipts');
 const final=await browserGet('/portal/v3/command');assert.equal(final.body.devices[0].era_no,'1');assert.equal(final.body.devices[0].active_key_slot,1);
 const {statePayload}=require('../src/services/deviceLifecycle');
 const state={device_id:cert.device_id,key_epoch:1,era_no:1,active_key_slot:1,counter:'18446744073709551615',timestamp:Math.floor(Date.now()/1000)};
 const nativeState=execFileSync(nativeExecutable,['--state',state.device_id,'1','1','1',state.counter,String(state.timestamp)],{encoding:'utf8'}).trim();assert.equal(nativeState,statePayload(state).toString('hex'));
 state.signature=sign(next,nativeState);
 const report=await call('/device/v3/state',state);assert.equal(report.status,200,JSON.stringify(report.body));assert.equal(report.body.duplicate,false);
 const replay=await call('/device/v3/state',state);assert.equal(replay.status,200);assert.equal(replay.body.duplicate,true);assert.equal(replay.body.received_at,report.body.received_at);
 const altered={...state,timestamp:state.timestamp+1};altered.signature=sign(next,statePayload(altered).toString('hex'));assert.equal((await call('/device/v3/state',altered)).status,409);
 const oldCounter={...state,counter:'18446744073709551614'};oldCounter.signature=sign(next,statePayload(oldCounter).toString('hex'));assert.equal((await call('/device/v3/state',oldCounter)).status,409);
 const observed=await pool.query('SELECT last_state_counter,attestation_status FROM device_trust_state WHERE device_id=$1',[cert.device_id]);assert.equal(observed.rows[0].last_state_counter,state.counter);assert.equal(observed.rows[0].attestation_status,'UNVERIFIED','a signed state report is not a firmware attestation');

 // Renewal recovers an expired certificate without changing device identity or its active key.
 await pool.query("UPDATE device_sync_registry_v2 SET expires_at=now()-interval '1 second' WHERE device_id=$1",[cert.device_id]);
 const renewal=await challenge('RENEW');const renewed=await commit(renewal,next,next);assert.equal(renewed.status,200,JSON.stringify(renewed.body));assert.equal(renewed.body.certificate.device_id,cert.device_id);assert.equal(renewed.body.certificate.key_epoch,1);assert.equal(renewed.body.certificate.active_key_slot,1);
 await pool.query("UPDATE device_sync_registry_v2 SET status='SUSPENDED' WHERE device_id=$1",[cert.device_id]);
 const resumed=await call('/admin/v3/devices/'+cert.device_id+'/resume',{},token);assert.equal(resumed.status,200);assert.equal(resumed.body.attestation_required,true);
 await pool.query("UPDATE device_sync_registry_v2 SET status='REVOKED' WHERE device_id=$1",[cert.device_id]);
 assert.equal((await call('/admin/v3/devices/'+cert.device_id+'/resume',{},token)).status,409,'revoked devices cannot be resumed');
 console.log('Verified: canonical legacy schema, enterprise fleet isolation/licensing, supervisory country scope, native dual-key transition, era gating and certificate lineage.');
};
