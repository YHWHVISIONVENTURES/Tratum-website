const crypto=require('node:crypto');
class TratumBankClient {
 constructor({baseUrl,apiKey,allowLoopbackHttp=false}) {
  const url=new URL(baseUrl);
  if(url.username || url.password || url.search || url.hash || url.pathname!=='/' ||
    (url.protocol!=='https:' && !(allowLoopbackHttp && url.protocol==='http:' && ['127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('HTTPS_BASE_URL_REQUIRED');
  if(typeof apiKey!=='string' || !apiKey)throw new Error('API_KEY_REQUIRED');
  this.baseUrl=url.origin;this.apiKey=apiKey;
 }
 async getDeviceDeltas(deviceId,fromIndex=0) {
  if(typeof deviceId!=='string' || !/^[0-9a-f]{16}$/.test(deviceId) || !Number.isInteger(fromIndex) || fromIndex<0 || fromIndex>0xffffffff)throw new Error('INVALID_CURSOR');
  const route=`/institution/v2/devices/${deviceId}/deltas?from_index=${fromIndex}`;
  return this.get(route);
 }
 async getDeviceDeltaProof(deviceId,batchId) {
  if(!/^[0-9a-f]{16}$/.test(deviceId) || !/^[0-9a-f]{64}$/.test(batchId))throw new Error('INVALID_REFERENCE');
  return this.get(`/institution/v2/devices/${deviceId}/batches/${batchId}`);
 }
 async get(route) {
  const timestamp=String(Date.now());
  const bodyHash=crypto.createHash('sha256').update('').digest('hex');
  const signature=crypto.createHmac('sha256',this.apiKey).update(`${timestamp}\nGET\n${route}\n${bodyHash}`).digest('hex');
  const response=await fetch(this.baseUrl+route,{headers:{'x-api-key':this.apiKey,'x-timestamp':timestamp,'x-signature':signature},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`TRATUM_API_${response.status}`);
  return response.json();
 }
}
module.exports={TratumBankClient};
