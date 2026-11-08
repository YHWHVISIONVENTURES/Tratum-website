const crypto=require('node:crypto');
function bytes(value,length,label) {
 if(Buffer.isBuffer(value)) {if(value.length===length)return value;}
 else if(typeof value==='string' && new RegExp(`^[0-9a-fA-F]{${length*2}}$`).test(value))return Buffer.from(value,'hex');
 throw new Error(`INVALID_${label}`);
}
function publicKey(raw) {
 const point=Buffer.concat([Buffer.from([4]),bytes(raw,64,'PUBLIC_KEY')]);
 crypto.ECDH.convertKey(point,'prime256v1',undefined,undefined,'uncompressed');
 return crypto.createPublicKey({key:Buffer.concat([Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200','hex'),point]),format:'der',type:'spki'});
}
// Reconstruct QSE signPayload's exact generic-payload context. No private keys or balance operations.
function buildPayloadContext(context) {
 if(!context || typeof context.payload_raw!=='string' || !/^(?:[0-9a-fA-F]{2}){32,100}$/.test(context.payload_raw))throw new Error('INVALID_PAYLOAD');
 const payload=Buffer.from(context.payload_raw,'hex');
 if(!Number.isInteger(context.counter) || context.counter<0 || context.counter>0xffffffff)throw new Error('INVALID_COUNTER');
 const counter=Buffer.alloc(4);counter.writeUInt32LE(context.counter);
 return Buffer.concat([payload,bytes(context.sessionNonce,8,'SESSION_NONCE'),counter,bytes(context.prevHash,32,'PREVIOUS_HASH'),
  bytes(context.peerPubKey,64,'PEER_PUBLIC_KEY'),bytes(context.peerID,8,'PEER_ID'),payload.subarray(24,32),bytes(context.merkleRoot,32,'MERKLE_ROOT')]);
}
function verifyPayload(message,length,signature,key,peerID) {
 try {
  if(!Buffer.isBuffer(message) || message.length!==length || length<188 || length>256)return false;
  const peer=bytes(peerID,8,'PEER_ID');
  if(!message.subarray(length-48,length-40).equals(peer))return false;
  return crypto.verify('sha256',message,{key:publicKey(key),dsaEncoding:'ieee-p1363'},bytes(signature,64,'SIGNATURE'));
 }catch{return false;}
}
module.exports={buildPayloadContext,verifyPayload};
