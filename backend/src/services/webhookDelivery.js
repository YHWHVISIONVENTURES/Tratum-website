const crypto=require('node:crypto');
const dns=require('node:dns').promises;
const https=require('node:https');
const net=require('node:net');
const pool=require('../db');
function encryptionKey() {
 const key=process.env.WEBHOOK_ENCRYPTION_KEY;
 if(!/^[a-f0-9]{64}$/.test(key || '')) throw new Error('WEBHOOK_KEY_UNAVAILABLE');
 return Buffer.from(key,'hex');
}
function validateConfiguration() {
 encryptionKey();
 if(!(process.env.WEBHOOK_ALLOWED_HOSTS || '').split(',').some(x=>x.trim()))throw new Error('WEBHOOK_ALLOWED_HOSTS_REQUIRED');
}
function encrypt(secret) {
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv);
 const body=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');
}
function decrypt(value) {
 const bytes=Buffer.from(value,'base64'),cipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),bytes.subarray(0,12));
 cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');
}
function target(value) {
 const url=new URL(value);
 const allowed=(process.env.WEBHOOK_ALLOWED_HOSTS || '').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(url.protocol!=='https:' || url.username || url.password || url.hash || (url.port && url.port!=='443') || net.isIP(url.hostname) || !allowed.includes(url.hostname.toLowerCase())) throw new Error('WEBHOOK_TARGET_NOT_ALLOWED');
 return url;
}
function publicIPv4(address) {
 if(net.isIP(address)!==4)return false;
 const [a,b]=address.split('.').map(Number);
 return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&(b===168||b===0||b===2)) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19||b===51)) || (a===203&&b===0));
}
async function deliver(urlValue,body,headers) {
 const url=target(urlValue),addresses=await dns.lookup(url.hostname,{all:true,family:4});
 if(!addresses.length || addresses.some(x=>!publicIPv4(x.address)))throw new Error('WEBHOOK_TARGET_NOT_PUBLIC');
 // Pin the verified address for this connection to prevent DNS rebinding. No redirect following.
 return new Promise((resolve,reject)=>{
  const request=https.request(url,{method:'POST',agent:false,headers:{...headers,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},
   lookup(host,options,callback){if(options.all)callback(null,[addresses[0]]);else callback(null,addresses[0].address,4);}},response=>{
    const status=response.statusCode;response.destroy();resolve(status);
   });
  const timer=setTimeout(()=>request.destroy(new Error('WEBHOOK_TIMEOUT')),10000);
  request.once('close',()=>clearTimeout(timer));request.once('error',reject);request.end(body);
 });
}
async function enqueue(client,institution,batchId,deviceId) {
 const id='device.delta.accepted:'+batchId;
 const payload={id,type:'device.delta.accepted',institution_id:institution,data:{device_id:deviceId,batch_id:batchId,financial_finality:false}};
 await client.query(`INSERT INTO institution_webhook_outbox(event_id,institution_id,payload)
  SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM institution_webhook_endpoints WHERE institution_id=$2 AND enabled)
  ON CONFLICT(event_id) DO NOTHING`,[id,institution,payload]);
}
async function cycle(send=deliver) {
 await pool.query("UPDATE institution_webhook_outbox SET status='FAILED',lease_token=NULL,leased_until=NULL WHERE status='DELIVERING' AND attempts>=10 AND leased_until<clock_timestamp()");
 // A lease survives process death; another worker retries after expiry. Delivery is at least once.
 const lease=crypto.randomUUID();
 const claimed=await pool.query(`UPDATE institution_webhook_outbox SET status='DELIVERING',lease_token=$1,
  leased_until=clock_timestamp()+interval '30 seconds',attempts=attempts+1
  WHERE event_id=(SELECT o.event_id FROM institution_webhook_outbox o
   JOIN institution_webhook_endpoints e USING(institution_id)
   JOIN institutions i ON i.id::text=o.institution_id
   WHERE e.enabled AND i.status='active' AND o.attempts<10 AND o.next_attempt_at<=clock_timestamp()
   AND (o.status='PENDING' OR (o.status='DELIVERING' AND o.leased_until<clock_timestamp()))
   ORDER BY o.next_attempt_at FOR UPDATE OF o SKIP LOCKED LIMIT 1)
  RETURNING *`,[lease]);
 const event=claimed.rows[0];if(!event)return false;
 let status=null;
 try {
  const endpoint=await pool.query(`SELECT e.* FROM institution_webhook_endpoints e JOIN institutions i ON i.id::text=e.institution_id
   WHERE e.institution_id=$1 AND e.enabled AND i.status='active'`,[event.institution_id]);
  if(!endpoint.rowCount)throw new Error('ENDPOINT_DISABLED');
  const secret=decrypt(endpoint.rows[0].secret_ciphertext),body=JSON.stringify(event.payload),timestamp=String(Date.now());
  const signature=crypto.createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');
  status=await send(endpoint.rows[0].url,body,{'X-Tratum-Event-Id':event.event_id,'X-Tratum-Timestamp':timestamp,'X-Tratum-Signature':'v1='+signature});
  if(status<200 || status>=300)throw new Error('DELIVERY_REJECTED');
  await pool.query(`UPDATE institution_webhook_outbox SET status='DELIVERED',delivered_at=clock_timestamp(),
   last_http_status=$3,lease_token=NULL,leased_until=NULL WHERE event_id=$1 AND lease_token=$2`,[event.event_id,lease,status]);
 } catch {
  await pool.query(`UPDATE institution_webhook_outbox SET status=CASE WHEN attempts>=10 THEN 'FAILED' ELSE 'PENDING' END,
   next_attempt_at=clock_timestamp()+make_interval(secs=>LEAST(3600,5*power(2,attempts)::int)),
   last_http_status=$3,lease_token=NULL,leased_until=NULL WHERE event_id=$1 AND lease_token=$2`,[event.event_id,lease,status]);
 }
 return true;
}
module.exports={encrypt,target,publicIPv4,enqueue,cycle,validateConfiguration};
