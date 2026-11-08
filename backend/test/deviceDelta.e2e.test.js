const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const enabled=process.env.TRATUM_E2E==='1';

test('PostgreSQL: provisioning, native delta, isolated bank sessions, signed webhook retries and revocation', {skip:!enabled},async()=>{
 const {Pool}=require('pg');
 const express=require('express');
 const bcrypt=require('bcryptjs');
 // An explicitly isolated loopback test cluster; never reads production .env.
 const port=Number(process.env.TRATUM_E2E_PORT || 55439);
 assert.equal(port,55439);
 const dbName=`tratum_e2e_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
 const admin=new Pool({host:'127.0.0.1',port,user:'tratum_test',database:'postgres',password:'',connectionTimeoutMillis:3000});
 fs.mkdirSync(path.join(__dirname,'../work'),{recursive:true});
 const keyDir=fs.mkdtempSync(path.join(__dirname,'../work/e2e-keys-'));
 let server,pool;
 try {
  await admin.query(`CREATE DATABASE ${dbName}`);
  Object.assign(process.env,{DB_HOST:'127.0.0.1',DB_PORT:String(port),DB_USER:'tratum_test',DB_NAME:dbName,DB_PASSWORD:'',ADMIN_JWT_SECRET:crypto.randomBytes(48).toString('hex')});
  const root=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  process.env.TRATUM_ROOT_CA_PRIVATE_KEY_PATH=path.join(keyDir,'private.pem');
  process.env.TRATUM_ROOT_CA_CERTIFICATE_PATH=path.join(keyDir,'public.pem');
  fs.writeFileSync(process.env.TRATUM_ROOT_CA_PRIVATE_KEY_PATH,root.privateKey.export({type:'pkcs8',format:'pem'}));
  fs.writeFileSync(process.env.TRATUM_ROOT_CA_CERTIFICATE_PATH,root.publicKey.export({type:'spki',format:'pem'}));
  pool=require('../src/db');
  const migrationDir=path.join(__dirname,'../migrations');
  // Exercise the deployment runner itself, including safe repeated execution.
  const migrate=path.join(__dirname,'../scripts/migrate.js');
  execFileSync(process.execPath,[migrate,'--apply'],{env:process.env,stdio:'pipe'});
  execFileSync(process.execPath,[migrate,'--apply'],{env:process.env,stdio:'pipe'});
  const migrationCount=await pool.query('SELECT count(*) FROM tratum_schema_migrations');
  assert.equal(Number(migrationCount.rows[0].count),fs.readdirSync(migrationDir).filter(value=>value.endsWith('.sql')).length);
  await pool.query("INSERT INTO admin_roles VALUES('OPERATOR',$1)",[JSON.stringify(['INSTITUTIONS_MANAGE','DEVICE_ENROLL','OPS_VIEW'])]);
  const password=crypto.randomBytes(16).toString('hex');
  await pool.query("INSERT INTO admin_users(email,password_hash,role_code,status) VALUES('operator@example.test',$1,'OPERATOR','ACTIVE')",[await bcrypt.hash(password,4)]);
  process.env.PORTAL_ORIGIN='https://portal.example.test';
  const {app}=require('../src/admin-app');
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(route,body,token){
   const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
   return {status:response.status,body:await response.json()};
  }
  const login=await call('/admin/v1/auth/login',{email:'operator@example.test',password});assert.equal(login.status,200);
  const token=login.body.token;
  assert.equal((await fetch(base+'/health')).status,200);
  await require('../src/services/workerObservation').observe('e2e-cycle','started');
  const runtime=await fetch(base+'/admin/v1/dashboard/runtime',{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(runtime.status,200);assert.equal((await runtime.json()).workers.items[0].status,'running');
  assert.equal((await call('/admin/institutions',{name:'Unauthorized',type:'BANK'})).status,401);
  const bankA=await call('/admin/institutions',{name:'Bank A',type:'BANK'},token);
  const bankB=await call('/admin/institutions',{name:'Bank B',type:'BANK'},token);
  assert.equal(bankA.status,200);assert.ok(bankA.body.api_key_raw);assert.equal(bankB.status,200);
  const stored=await pool.query('SELECT api_key FROM institutions WHERE id=$1',[bankA.body.institution.id]);
  assert.notEqual(stored.rows[0].api_key,bankA.body.api_key_raw);
  process.env.WEBHOOK_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
  process.env.WEBHOOK_ALLOWED_HOSTS='bank-a.example.test';
  const webhookSecret=crypto.randomBytes(32).toString('hex');
  const endpoint=await fetch(base+`/admin/v2/institutions/${bankA.body.institution.id}/webhook`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({url:'https://bank-a.example.test/tratum',secret:webhookSecret})});
  assert.equal(endpoint.status,200);
  const device=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const jwk=device.publicKey.export({format:'jwk'});
  const pub=Buffer.concat([Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('hex');
  const codec=require('../src/services/deviceDeltaCodec');
  const {verifyCertificate}=require('../src/services/deviceCertificateV2');
  const challenge=await call('/admin/v2/device-enrollment/challenges',{public_key:pub,institution_id:String(bankA.body.institution.id)},token);
  assert.equal(challenge.status,201);
  const nativeExecutable=process.env.TRATUM_NATIVE_CODEC || path.resolve(__dirname,'../../firmware-v2/test/encode_fixture.exe');
  const nativeEnrollment=execFileSync(nativeExecutable,['--enroll',challenge.body.challenge,pub,codec.sha(Buffer.from(String(bankA.body.institution.id))).toString('hex')],{encoding:'utf8'}).trim();
  assert.equal(nativeEnrollment,challenge.body.signing_payload,'native enrollment bytes must match the server');
  const proof=crypto.sign('sha256',Buffer.from(challenge.body.signing_payload,'hex'),{key:device.privateKey,dsaEncoding:'ieee-p1363'}).toString('hex');
  const badEnroll=await call('/device/v2/enroll',{challenge:challenge.body.challenge,signature:'00'.repeat(64)});assert.equal(badEnroll.status,403);
  const enrolled=await call('/device/v2/enroll',{challenge:challenge.body.challenge,signature:proof});assert.equal(enrolled.status,201);
  const cert=enrolled.body.certificate;
  assert.ok(verifyCertificate(cert,root.publicKey));
  assert.equal(verifyCertificate({...cert,institution_id:String(bankB.body.institution.id)},root.publicKey),false);
  const legacy=Buffer.from(cert.firmware_certificate,'hex');assert.equal(legacy.length,136);
  assert.ok(crypto.verify('sha256',legacy.subarray(0,72),{key:root.publicKey,dsaEncoding:'ieee-p1363'},legacy.subarray(72)));
  const recovered=await call('/device/v2/enroll',{challenge:challenge.body.challenge,signature:proof});
  assert.equal(recovered.status,200);assert.deepEqual(recovered.body.certificate,cert);
  assert.equal((await call('/device/v2/enroll',{challenge:challenge.body.challenge,signature:'00'.repeat(64)})).status,403);
  function record(nonce,amount=15000){
   const raw=Buffer.alloc(176);raw.writeUInt32LE(amount,0);raw.writeUInt32LE(1700000000,4);
   Buffer.from(cert.device_id,'hex').copy(raw,8);Buffer.from('1122334455667788','hex').copy(raw,16);
   raw.writeBigUInt64LE(nonce,24);crypto.randomBytes(32).copy(raw,39);raw[171]=1;return raw;
  }
  function envelope(records,from=0,previous=codec.ZERO){
   let root=Buffer.from(previous,'hex');for(const raw of records)root=codec.sha(Buffer.concat([root,codec.sha(raw)]));
   const body={version:2,device_id:cert.device_id,key_epoch:0,from_index:from,previous_root:previous,sync_root:root.toString('hex'),transactions:records.map(raw=>raw.toString('hex'))};
   const encoded=codec.encodeDelta(body);
   const native=execFileSync(nativeExecutable,[body.device_id,'0',String(from),previous,body.transactions.join(''),body.sync_root],{encoding:'utf8'}).trim();
   assert.equal(native,encoded.message.toString('hex'),'native C++ and backend canonical bytes must agree');
   body.signature=crypto.sign('sha256',Buffer.from(native,'hex'),{key:device.privateKey,dsaEncoding:'ieee-p1363'}).toString('hex');return body;
  }
  const original=envelope([record(18446744073709551615n)]);
  const malformed={...original,transactions:[original.transactions[0].slice(0,-2)]};
  assert.equal((await call('/device/v2/deltas',malformed)).status,400);
  assert.equal((await call('/device/v2/deltas',{...original,signature:'00'.repeat(64)})).status,403);
  const [first,retry]=await Promise.all([call('/device/v2/deltas',original),call('/device/v2/deltas',original)]);
  assert.deepEqual([first.status,retry.status].sort(),[200,202]);assert.equal(first.body.batch_id,retry.body.batch_id);
  assert.equal(first.body.financial_finality,false);
  const conflict=envelope([record(2n)],0);assert.equal((await call('/device/v2/deltas',conflict)).status,409);
  const second=envelope([record(2n)],1,original.sync_root);assert.equal((await call('/device/v2/deltas',second)).status,202);
  // A reused sender nonce in a later batch rolls back its batch and cursor together.
  const nonceReplay=envelope([record(2n)],2,second.sync_root);assert.equal((await call('/device/v2/deltas',nonceReplay)).status,409);
  const cursor=await pool.query('SELECT next_index FROM device_sync_registry_v2 WHERE device_id=$1',[cert.device_id]);assert.equal(cursor.rows[0].next_index,'2');
  const batches=await pool.query('SELECT count(*) FROM device_delta_batches_v2');assert.equal(batches.rows[0].count,'2');
  const outbox=await pool.query('SELECT * FROM institution_webhook_outbox');assert.equal(outbox.rowCount,2);
  const delivery=require('../src/services/webhookDelivery');
  const received=[];
  async function receiver(url,body,headers) {
   assert.equal(url,'https://bank-a.example.test/tratum');
   const expected=crypto.createHmac('sha256',webhookSecret).update(headers['X-Tratum-Timestamp']+'.'+body).digest('hex');
   assert.equal(headers['X-Tratum-Signature'],'v1='+expected);
   assert.equal(JSON.parse(body).data.financial_finality,false);
   received.push(headers['X-Tratum-Event-Id']);return 204;
  }
  await Promise.all([delivery.cycle(receiver),delivery.cycle(receiver)]);
  assert.equal(new Set(received).size,2);assert.equal(received.length,2);
  assert.equal((await pool.query("SELECT count(*) FROM institution_webhook_outbox WHERE status='DELIVERED'")).rows[0].count,'2');
  assert.equal(await delivery.cycle(receiver),false);
  // Recover an expired lease, retry rejected delivery, then acknowledge the stable event identity.
  const retryEvent=outbox.rows[0].event_id;
  await pool.query("UPDATE institution_webhook_outbox SET status='DELIVERING',leased_until=now()-interval '1 second',next_attempt_at=now() WHERE event_id=$1",[retryEvent]);
  await delivery.cycle(async()=>503);
  const failed=await pool.query('SELECT status,last_http_status,attempts FROM institution_webhook_outbox WHERE event_id=$1',[retryEvent]);
  assert.equal(failed.rows[0].status,'PENDING');assert.equal(failed.rows[0].last_http_status,503);
  await pool.query('UPDATE institution_webhook_outbox SET next_attempt_at=now() WHERE event_id=$1',[retryEvent]);
  await delivery.cycle(receiver);assert.equal(received[2],retryEvent);
  const ciphertext=await pool.query('SELECT secret_ciphertext FROM institution_webhook_endpoints');assert.ok(!ciphertext.rows[0].secret_ciphertext.includes(webhookSecret));
  assert.throws(()=>delivery.target('https://127.0.0.1/'),/NOT_ALLOWED/);
  assert.throws(()=>delivery.target('http://bank-a.example.test/'),/NOT_ALLOWED/);
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','100.64.0.1','::1'])assert.equal(delivery.publicIPv4(ip),false);
  async function bankRead(key,route,signatureRoute=route){
   const timestamp=String(Date.now());
   const hash=crypto.createHash('sha256').update('').digest('hex');
   const signature=crypto.createHmac('sha256',key).update(`${timestamp}\nGET\n${signatureRoute}\n${hash}`).digest('hex');
   const response=await fetch(base+route,{headers:{'x-api-key':key,'x-timestamp':timestamp,'x-signature':signature}});return {status:response.status,body:await response.json()};
  }
  const route=`/institution/v2/devices/${cert.device_id}/deltas`;
  // Browser sessions use separate institution users; machine credentials never enter the browser.
  const bankPassword='A-strong-test-password-2026';
  const userA=await call(`/admin/v2/institutions/${bankA.body.institution.id}/users`,{email:'reader@a.test',password:bankPassword},token);
  assert.equal(userA.status,201);
  assert.equal((await call(`/admin/v2/institutions/${bankB.body.institution.id}/users`,{email:'reader@b.test',password:bankPassword},token)).status,201);
  async function browserLogin(bank,email,origin=process.env.PORTAL_ORIGIN) {
   return fetch(base+'/portal/v2/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({institution_id:String(bank.body.institution.id),email,password:bankPassword})});
  }
  assert.equal((await browserLogin(bankA,'reader@a.test','https://attacker.test')).status,403);
  assert.equal((await browserLogin(bankB,'reader@a.test')).status,401);
  const sessionA=await browserLogin(bankA,'reader@a.test');assert.equal(sessionA.status,200);
  assert.match(sessionA.headers.get('set-cookie'),/HttpOnly/);assert.match(sessionA.headers.get('set-cookie'),/SameSite=Strict/);
  let cookieA=sessionA.headers.get('set-cookie').split(';')[0];
  const sessionB=await browserLogin(bankB,'reader@b.test');assert.equal(sessionB.status,200);
  const cookieB=sessionB.headers.get('set-cookie').split(';')[0];
  async function browserGet(path,cookie=cookieA){const r=await fetch(base+path,{headers:{Cookie:cookie}});return {status:r.status,body:await r.json()};}
  assert.equal((await browserGet('/portal/v2/overview')).body.devices.total,'1');
  assert.equal((await browserGet('/portal/v2/overview',cookieB)).body.devices.total,'0');
  assert.equal((await browserGet('/portal/v2/webhooks')).body.events.length,2);
  assert.equal((await browserGet('/portal/v2/webhooks',cookieB)).body.events.length,0);
  assert.equal((await browserGet('/portal/v2/devices?institution_id='+bankB.body.institution.id)).body.devices[0].device_id,cert.device_id);
  assert.equal((await browserGet(`/portal/v2/devices/${cert.device_id}/batches`,cookieB)).status,404);
  assert.equal((await browserGet(`/portal/v2/devices/${cert.device_id}/batches`)).body.batches.length,2);
  assert.equal((await browserGet('/admin/v1/dashboard/runtime')).status,401);
  assert.equal((await browserGet('/portal/v2/devices','')).status,401);
  const sessionHash=await pool.query('SELECT token_hash FROM institution_sessions WHERE user_id=$1',[userA.body.user.id]);
  assert.notEqual(sessionHash.rows[0].token_hash,cookieA.split('=')[1]);
  const logout=await fetch(base+'/portal/v2/auth/logout',{method:'POST',headers:{Origin:process.env.PORTAL_ORIGIN,Cookie:cookieB}});assert.equal(logout.status,200);
  assert.equal((await browserGet('/portal/v2/me',cookieB)).status,401);
  await pool.query("UPDATE institution_users SET status='DISABLED' WHERE id=$1",[userA.body.user.id]);
  assert.equal((await browserGet('/portal/v2/me')).status,401);
  await pool.query("UPDATE institution_users SET status='ACTIVE' WHERE id=$1",[userA.body.user.id]);
  await pool.query("UPDATE institution_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",[userA.body.user.id]);
  assert.equal((await browserGet('/portal/v2/me')).status,401);
  const refreshedLogin=await browserLogin(bankA,'reader@a.test');assert.equal(refreshedLogin.status,200);
  cookieA=refreshedLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await browserGet('/portal/v2/me')).status,200);
  const visible=await bankRead(bankA.body.api_key_raw,route);assert.equal(visible.status,200);assert.equal(visible.body.records.length,2);
  assert.equal(visible.body.records[0].summary.nonce,'18446744073709551615');
  assert.equal((await bankRead(bankB.body.api_key_raw,route)).status,404);
  assert.equal((await bankRead(bankA.body.api_key_raw,route+'?from_index=1',route)).status,403);
  assert.equal((await bankRead(bankA.body.api_key_raw,route+'?from_index=1')).body.records.length,1);
  const {TratumBankClient}=require('../sdk/bankClient');
  const sdk=new TratumBankClient({baseUrl:base,apiKey:bankA.body.api_key_raw,allowLoopbackHttp:true});
  assert.equal((await sdk.getDeviceDeltas(cert.device_id,1)).records.length,1);
  const evidence=await sdk.getDeviceDeltaProof(cert.device_id,first.body.batch_id);
  const {verifyDeltaProof}=require('../sdk/verifyDeltaProof');
  assert.ok(verifyDeltaProof(evidence.proof,root.publicKey));
  assert.equal(verifyDeltaProof({...evidence.proof,institution_id:String(bankB.body.institution.id)},root.publicKey),false);
  assert.equal(verifyDeltaProof({...evidence.proof,signature:'00'.repeat(64)},root.publicKey),false);
  assert.equal((await bankRead(bankB.body.api_key_raw,`/institution/v2/devices/${cert.device_id}/batches/${first.body.batch_id}`)).status,404);
  async function feature(key,kind,payload){return fetch(base+`/institution/v1/device-features/${kind}`,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'Idempotency-Key':'feature_key_12345678'},body:JSON.stringify({device_id:cert.device_id,...payload})});}
  assert.equal((await feature(bankA.body.api_key_raw,'savings_goal',{name:'School',target_minor:'500000'})).status,202);
  assert.equal((await feature(bankB.body.api_key_raw,'airtime',{phone:'08012345678',network:'MTN',amount_minor:'10000'})).status,404);
  await pool.query("UPDATE device_sync_registry_v2 SET expires_at=now()-interval '1 second' WHERE device_id=$1",[cert.device_id]);
  assert.equal((await call('/device/v2/deltas',original)).status,403);
  await pool.query("UPDATE device_sync_registry_v2 SET expires_at=now()+interval '1 day' WHERE device_id=$1",[cert.device_id]);
  assert.equal((await call(`/admin/v2/devices/${cert.device_id}/revoke`,{},token)).status,200);
  assert.equal((await call('/device/v2/deltas',original)).status,403);
  assert.equal((await bankRead(bankA.body.api_key_raw,route)).body.status,'REVOKED');
  await pool.query("UPDATE institutions SET status='disabled' WHERE id=$1",[bankA.body.institution.id]);
  assert.equal((await browserGet('/portal/v2/me')).status,401);
  assert.equal((await bankRead(bankA.body.api_key_raw,route)).status,403);
  await pool.query("UPDATE admin_users SET status='DISABLED' WHERE email='operator@example.test'");
  assert.equal((await call('/admin/institutions',{name:'Denied',type:'BANK'},token)).status,401);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(pool)await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(()=>{});await admin.end();
  fs.rmSync(keyDir,{recursive:true,force:true});
 }
});
