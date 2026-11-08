const test=require('node:test');const assert=require('node:assert/strict');
const {describeWorker}=require('../src/services/workerStatus');
const now=Date.now();const date=n=>new Date(now+n).toISOString();
test('heartbeat with no cycle is waiting',()=>assert.equal(describeWorker({observed_at:date(0)},now).status,'waiting'));
test('expired heartbeat is stale',()=>assert.equal(describeWorker({observed_at:date(-61000)},now).status,'stale'));
test('active cycle is running',()=>assert.equal(describeWorker({observed_at:date(0),last_started_at:date(-1000)},now).status,'running'));
test('rejected cycle is failed',()=>assert.equal(describeWorker({observed_at:date(0),last_outcome:'failed'},now).status,'failed'));
test('returned cycle is not settlement success',()=>assert.equal(describeWorker({observed_at:date(0),last_outcome:'completed'},now).status,'cycle_returned'));
