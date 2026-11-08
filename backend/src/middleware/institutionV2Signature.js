const crypto=require('node:crypto');
module.exports=function institutionV2Signature(req,res,next) {
 const timestamp=req.get('x-timestamp'),signature=req.get('x-signature');
 if(!timestamp || !/^\d{13}$/.test(timestamp) || Math.abs(Date.now()-Number(timestamp))>300000 ||
  !signature || !/^[0-9a-f]{64}$/.test(signature)) return res.status(403).json({error:'INVALID_REQUEST_SIGNATURE'});
 const bodyHash=crypto.createHash('sha256').update(req.method==='GET'?'':JSON.stringify(req.body || {})).digest('hex');
 const expected=crypto.createHmac('sha256',req.get('x-api-key')).update(`${timestamp}\n${req.method}\n${req.originalUrl}\n${bodyHash}`).digest();
 if(!crypto.timingSafeEqual(expected,Buffer.from(signature,'hex'))) return res.status(403).json({error:'INVALID_REQUEST_SIGNATURE'});
 next();
};
