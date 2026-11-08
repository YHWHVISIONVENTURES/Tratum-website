const crypto=require('node:crypto');
// Pass the exact, unmodified HTTP body bytes, before JSON middleware transforms them.
function verifyWebhook(rawBody,headers,secret,now=Date.now()) {
 if(!Buffer.isBuffer(rawBody) || typeof secret!=='string' || secret.length<32)return false;
 const timestamp=headers['x-tratum-timestamp'],signature=headers['x-tratum-signature'];
 if(typeof timestamp!=='string' || !/^\d{13}$/.test(timestamp) || Math.abs(now-Number(timestamp))>300000 || typeof signature!=='string' || !/^v1=[a-f0-9]{64}$/.test(signature))return false;
 const expected=crypto.createHmac('sha256',secret).update(timestamp+'.').update(rawBody).digest();
 return crypto.timingSafeEqual(expected,Buffer.from(signature.slice(3),'hex'));
}
module.exports={verifyWebhook};
