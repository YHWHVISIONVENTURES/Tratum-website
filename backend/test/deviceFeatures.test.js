const test=require('node:test');
const assert=require('node:assert/strict');
const {validateFeature,fingerprint}=require('../src/services/deviceFeatureValidation');
const {describeWorker}=require('../src/services/workerStatus');
const input={device_id:'node_123',phone:'08012345678',network:'MTN',amount_minor:'10000'};
test('normalizes local Nigerian phone and keeps exact minor units',()=>{
 const result=validateFeature('airtime',input);
 assert.equal(result.phone,'+2348012345678');
 assert.equal(result.amount_minor,'10000');
 assert.equal(fingerprint('airtime',result),fingerprint('airtime',validateFeature('airtime',{...input,phone:'+2348012345678'})));
});
test('rejects malformed monetary values and unknown networks',()=>{
 for(const amount_minor of [10000,'-1','1e4','100.00','0','4999','10000001']) {
  assert.throws(()=>validateFeature('airtime',{...input,amount_minor}));
 }
 assert.throws(()=>validateFeature('airtime',{...input,network:'OTHER'}));
 assert.throws(()=>validateFeature('airtime',{...input,phone:'+12345678'}));
});
test('savings goal ignores supplied balances and tenant overrides',()=>{
 const result=validateFeature('savings_goal',{device_id:'node_123',name:' School ',target_minor:'500000',balance:'999',institution_id:'other'});
 assert.deepEqual(result,{device_id:'node_123',currency:'NGN',name:'School',target_minor:'500000'});
});
test('data requires provider plan identity and does not trust client price',()=>{
 const result=validateFeature('data',{...input,plan_id:'mtn_1gb',price:'1'});
 assert.equal(result.plan_id,'mtn_1gb'); assert.equal(result.price,undefined);
 assert.throws(()=>validateFeature('data',input));
});
test('idempotency fingerprints bind the complete normalized request',()=>{
 assert.notEqual(fingerprint('airtime',validateFeature('airtime',input)),fingerprint('airtime',validateFeature('airtime',{...input,amount_minor:'20000'})));
});
test('worker observations distinguish stale, failed, running and completed cycles',()=>{
 const now=1000000;
 const row={observed_at:new Date(now),last_started_at:new Date(now-100),last_finished_at:new Date(now),last_outcome:'completed'};
 assert.equal(describeWorker(row,now).status,'cycle_completed');
 assert.equal(describeWorker({...row,last_outcome:'failed'},now).status,'failed');
 assert.equal(describeWorker({...row,last_finished_at:null},now).status,'running');
 assert.equal(describeWorker(row,now+60001).status,'stale');
 assert.equal(describeWorker({...row,observed_at:'invalid'},now).status,'stale');
});
