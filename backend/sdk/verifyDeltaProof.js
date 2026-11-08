const codec=require('../src/services/deviceDeltaCodec');
const {verifyCertificate}=require('../src/services/deviceCertificateV2');
function verifyDeltaProof(proof,rootPublicKey){
 try {
  const message=Buffer.from(proof.signed_payload,'hex');
  if(message.length<98 || !message.subarray(0,16).equals(Buffer.from('TRATUM-DELTA-V2\0')))return false;
  const count=message.readUInt16LE(32);
  if(count<1 || count>32 || message.length!==98+count*176)return false;
  const device=message.subarray(16,24).toString('hex');
  if(device!==proof.device_id || proof.certificate.device_id!==device || proof.institution_id!==proof.certificate.institution_id || message.readUInt32LE(24)!==proof.certificate.key_epoch)return false;
  // Historical evidence is checked against certificate validity at receipt time.
  const received=Math.floor(new Date(proof.received_at).getTime()/1000);
  if(!Number.isFinite(received) || !verifyCertificate(proof.certificate,rootPublicKey,received))return false;
  const transactions=[];for(let i=0;i<count;i++)transactions.push(message.subarray(66+i*176,66+(i+1)*176).toString('hex'));
  const encoded=codec.encodeDelta({version:2,device_id:device,key_epoch:message.readUInt32LE(24),from_index:message.readUInt32LE(28),previous_root:message.subarray(34,66).toString('hex'),sync_root:message.subarray(-32).toString('hex'),transactions});
  return encoded.message.equals(message) && encoded.batchId===proof.batch_id && codec.verifySignature(message,proof.signature,proof.certificate.public_key);
 }catch{return false;}
}
module.exports={verifyDeltaProof};
