const crypto=require('node:crypto');
const ZERO='0'.repeat(64);
const DOMAIN=Buffer.from('TRATUM-DELTA-V2\0');
function hex(value,bytes,label) {
 if(typeof value!=='string' || !new RegExp(`^[0-9a-f]{${bytes*2}}$`).test(value)) throw new Error(`INVALID_${label}`);
 return Buffer.from(value,'hex');
}
function uint(value,label) {
 if(!Number.isInteger(value) || value<0 || value>0xffffffff) throw new Error(`INVALID_${label}`);
 const out=Buffer.alloc(4);out.writeUInt32LE(value);return out;
}
function sha(data){return crypto.createHash('sha256').update(data).digest();}
function publicKey(raw) {
 const point=Buffer.concat([Buffer.from([4]),hex(raw,64,'PUBLIC_KEY')]);
 crypto.ECDH.convertKey(point,'prime256v1',undefined,undefined,'uncompressed');
 return crypto.createPublicKey({key:Buffer.concat([Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200','hex'),point]),format:'der',type:'spki'});
}
function deviceId(raw){publicKey(raw);return sha(Buffer.from(raw,'hex')).subarray(0,8).toString('hex');}
function recordSummary(raw) {
 const amount=raw.readUInt32LE(0);
 if(!amount) throw new Error('INVALID_AMOUNT');
 return {amount_raw:String(amount),amount_unit:'FIRMWARE_UNIT_UNCONFIRMED',timestamp:raw.readUInt32LE(4),
  sender_id:raw.subarray(8,16).toString('hex'),receiver_id:raw.subarray(16,24).toString('hex'),
  nonce:raw.readBigUInt64LE(24).toString(),legacy_tx_hash:raw.subarray(39,71).toString('hex'),
  flags:raw[171],key_epoch:raw.readUInt32LE(172)};
}
function encodeDelta(body) {
 if(!body || body.version!==2 || !Array.isArray(body.transactions) || !body.transactions.length || body.transactions.length>32) throw new Error('INVALID_DELTA');
 const id=hex(body.device_id,8,'DEVICE_ID');
 const epoch=uint(body.key_epoch,'KEY_EPOCH');

 const index=uint(body.from_index,'INDEX');
 if(body.from_index+body.transactions.length>0xffffffff) throw new Error('INDEX_OVERFLOW');
 const previous=hex(body.previous_root,32,'PREVIOUS_ROOT');
 const count=Buffer.alloc(2);count.writeUInt16LE(body.transactions.length);
 const records=body.transactions.map(value=>hex(value,176,'RECORD'));
 const summaries=records.map(recordSummary);
 for(const summary of summaries) {
  if(summary.sender_id!==body.device_id && summary.receiver_id!==body.device_id) throw new Error('UNRELATED_RECORD');
 }
 let root=previous;
 for(const raw of records) root=sha(Buffer.concat([root,sha(raw)]));
 if(root.toString('hex')!==body.sync_root) throw new Error('INVALID_SYNC_ROOT');
 const message=Buffer.concat([DOMAIN,id,epoch,index,count,previous,...records,root]);
 return {message,records,summaries,batchId:sha(message).toString('hex'),nextIndex:body.from_index+records.length};
}
function verifySignature(message,signature,key) {
 return crypto.verify('sha256',message,{key:publicKey(key),dsaEncoding:'ieee-p1363'},hex(signature,64,'SIGNATURE'));
}
function enrollmentMessage(challenge,pub,institution) {
 return Buffer.concat([Buffer.from('TRATUM-ENROLL-V2\0'),hex(challenge,32,'CHALLENGE'),hex(pub,64,'PUBLIC_KEY'),sha(Buffer.from(institution))]);
}
module.exports={ZERO,hex,uint,sha,publicKey,deviceId,encodeDelta,verifySignature,enrollmentMessage};
