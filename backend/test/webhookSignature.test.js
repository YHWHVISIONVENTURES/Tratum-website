const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {verifyWebhook}=require('../sdk/verifyWebhook');
test('bank receiver verifies exact bytes, timestamp and signature before accepting an event',()=>{
 const secret=crypto.randomBytes(32).toString('hex'),body=Buffer.from('{"id":"event-1","data":{"financial_finality":false}}'),now=Date.now();
 const headers={'x-tratum-timestamp':String(now),'x-tratum-signature':'v1='+crypto.createHmac('sha256',secret).update(String(now)+'.').update(body).digest('hex')};
 assert.equal(verifyWebhook(body,headers,secret,now),true);
 assert.equal(verifyWebhook(Buffer.from(body.toString()+' '),headers,secret,now),false);
 assert.equal(verifyWebhook(body,headers,secret,now+300001),false);
 assert.equal(verifyWebhook(body,{...headers,'x-tratum-signature':'v1=bad'},secret,now),false);
 assert.equal(verifyWebhook(body,headers,'different-secret-value-1234567890123456',now),false);
});
