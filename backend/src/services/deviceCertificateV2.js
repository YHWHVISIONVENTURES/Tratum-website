const codec=require('./deviceDeltaCodec');
function certificatePayload(certificate) {
 if(!certificate || certificate.version!==2 || codec.deviceId(certificate.public_key)!==certificate.device_id ||
  typeof certificate.institution_id!=='string' || !certificate.institution_id || certificate.institution_id.length>128) throw new Error('INVALID_CERTIFICATE');
 return Buffer.concat([Buffer.from('TRATUM-CERT-V2\0'),codec.hex(certificate.public_key,64,'PUBLIC_KEY'),codec.hex(certificate.device_id,8,'DEVICE_ID'),
  codec.sha(Buffer.from(certificate.institution_id)),codec.uint(certificate.key_epoch,'EPOCH'),codec.uint(certificate.issued_at,'ISSUED'),codec.uint(certificate.expires_at,'EXPIRY')]);
}
function verifyCertificate(certificate,rootPublicKey,now=Math.floor(Date.now()/1000)) {
 try {
  const crypto=require('node:crypto');
  const payload=certificatePayload(certificate);
  return certificate.key_epoch>=0 && certificate.issued_at<=now && certificate.expires_at>now && certificate.expires_at>certificate.issued_at &&
   payload.toString('hex')===certificate.signing_payload && crypto.verify('sha256',payload,{key:rootPublicKey,dsaEncoding:'ieee-p1363'},codec.hex(certificate.signature,64,'SIGNATURE'));
 }catch{return false;}
}
module.exports={certificatePayload,verifyCertificate};
