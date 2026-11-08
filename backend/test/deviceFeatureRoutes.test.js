const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const records=new Map();
let owned=true;
const queries=[];
const db={async query(sql,args){
 queries.push(sql);
 if(sql.startsWith('SELECT 1 FROM device_sync_registry_v2')) return {rows:owned?[{}]:[]};
 const key=args[1];
 if(sql.startsWith('INSERT')) {
  const composite=`${args[1]}:${args[3]}`;
  if(records.has(composite)) return {rows:[]};
  const row={id:args[0],status:'AWAITING_CUSTOMER_AUTHORIZATION',created_at:new Date().toISOString(),request_hash:args[4]};
  records.set(composite,row);
  const {request_hash,...publicRow}=row;
  return {rows:[publicRow]};
 }
 return {rows:[records.get(`${args[0]}:${key}`)].filter(Boolean)};
}};
require.cache[require.resolve('../src/db')]={exports:db};
require.cache[require.resolve('../src/middleware/institutionAuth')]={exports:(req,res,next)=>{
 if(!req.get('x-api-key')) return res.sendStatus(401);
 req.institution={id:req.get('x-api-key')};next();
}};
test('request API scopes ownership, rejects conflicting retries and never fulfills purchases',async()=>{
 const app=express();app.use(express.json());app.use(require('../src/routes/deviceFeatureRoutes'));
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${server.address().port}/institution/v1/device-features/airtime`;
 const payload={device_id:'node_123',phone:'08012345678',network:'MTN',amount_minor:'10000',institution_id:'bank-b'};
 async function send(body=payload,tenant='bank-a') {
  return fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':tenant,'Idempotency-Key':'request_key_12345678'},body:JSON.stringify(body)});
 }
 try {
  const first=await send();assert.equal(first.status,202);
  const data=await first.json();assert.equal(data.funds_moved,false);assert.equal(data.delivery_confirmed,false);
  assert.equal(data.request.status,'AWAITING_CUSTOMER_AUTHORIZATION');
  const replay=await send();assert.equal(replay.status,200);assert.equal((await replay.json()).request.id,data.request.id);
  assert.equal((await send({...payload,amount_minor:'20000'})).status,409);
  assert.equal((await send(payload,'bank-b')).status,202); // independent tenant key scope
  owned=false;assert.equal((await send()).status,404);
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).status,401);
  assert.ok(!queries.some(sql=>/UPDATE|ledger|treasury/.test(sql)));
 } finally {await new Promise(resolve=>server.close(resolve));}
});
