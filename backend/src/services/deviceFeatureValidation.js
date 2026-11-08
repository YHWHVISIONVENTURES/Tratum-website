const crypto = require('node:crypto');
function validateFeature(kind, body) {
 if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_REQUEST');
 if (typeof body.device_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.device_id)) throw new Error('INVALID_DEVICE');
 const result={device_id:body.device_id, currency:'NGN'};
 if (kind==='savings_goal') {
  if (typeof body.name!=='string' || !body.name.trim() || body.name.trim().length>60) throw new Error('INVALID_POCKET_NAME');
  if (typeof body.target_minor!=='string' || !/^[1-9][0-9]{0,11}$/.test(body.target_minor)) throw new Error('INVALID_TARGET');
  return {...result,name:body.name.trim(),target_minor:body.target_minor};
 }
 if (!['airtime','data'].includes(kind)) throw new Error('INVALID_PRODUCT');
 if (typeof body.phone!=='string') throw new Error('INVALID_PHONE');
 const phone=body.phone.replace(/[ ()-]/g,'').replace(/^0/,'+234');
 if (!/^\+234[789][01][0-9]{8}$/.test(phone)) throw new Error('INVALID_PHONE');
 if (!['MTN','AIRTEL','GLO','9MOBILE'].includes(body.network)) throw new Error('INVALID_NETWORK');
 if (kind==='airtime') {
  if (typeof body.amount_minor!=='string' || !/^[1-9][0-9]{0,7}$/.test(body.amount_minor) || BigInt(body.amount_minor)<5000n || BigInt(body.amount_minor)>10000000n) throw new Error('INVALID_AMOUNT');
  return {...result,phone,network:body.network,amount_minor:body.amount_minor};
 }
 if (typeof body.plan_id!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.plan_id)) throw new Error('INVALID_PLAN');
 return {...result,phone,network:body.network,plan_id:body.plan_id};
}
function fingerprint(kind,payload) {
 return crypto.createHash('sha256').update(JSON.stringify({kind,payload})).digest('hex');
}
module.exports={validateFeature,fingerprint};
