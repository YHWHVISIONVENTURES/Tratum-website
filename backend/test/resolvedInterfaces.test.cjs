const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),http=require('node:http');
const {resolveRail}=require('../src/services/railResolver');
const registry=require('../src/services/railAdapterRegistry');
const qse=require('../src/crypto/QuantumSecureEngine');
const {verifyTransaction}=require('../src/security/verificationEngine');
const rail={rail_code:'PAPSS',rail_type:'FIAT',active:true,priority_score:100,settlement_mode:'GROSS',estimated_finality:'configured-by-institution'};
const context={source_currency:'NGN',destination_currency:'GHS',amount:'1000.25',liquidity_health:5000,sourceRails:[rail],destinationRails:[rail]};
test('rail resolution uses common approved configuration and preserves finality metadata',()=>{
 assert.equal(resolveRail(context).rail_code,'PAPSS');
 assert.equal(resolveRail(context).settlement_mode,'GROSS');
 assert.throws(()=>resolveRail({...context,destinationRails:[]}),/NO_APPROVED_COMMON_RAIL/);
 assert.throws(()=>resolveRail({...context,online_state:'OFFLINE'}),/NO_APPROVED_COMMON_RAIL/);
 assert.throws(()=>resolveRail({...context,sourceRails:[{...rail,active:false}]}),/NO_APPROVED_COMMON_RAIL/);
 assert.throws(()=>resolveRail({...context,preferred_rail:'UNAPPROVED'}),/NO_APPROVED_COMMON_RAIL/);
 assert.throws(()=>resolveRail({...context,sourceRails:[{...rail,settlement_mode:null}]}),/FINALITY_CONFIGURATION/);
});
test('adapter registry rejects unconfigured execution and partial invalid configuration',()=>{
 assert.throws(()=>registry.getRailAdapter('UNKNOWN','NG'),/NOT_CONFIGURED/);
 assert.throws(()=>registry.configureRailAdapters([{rail:'HTTP_TEST',country:'NG',kind:'BANK_HTTP',endpoint:'http://example.test',apiKeyEnv:'KEY',secretEnv:'SECRET'}],{KEY:'k',SECRET:'s'}),/HTTPS/);
 assert.throws(()=>registry.getRailAdapter('HTTP_TEST','NG'),/NOT_CONFIGURED/);
});
test('real HTTP adapter sends the stable idempotency reference and signed request',async()=>{
 const requests=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  requests.push({headers:req.headers,body});
  assert.equal(req.headers['idempotency-key'],body.reference);
  assert.equal(req.headers['x-signature'],crypto.createHmac('sha256','test-secret').update(JSON.stringify(body)).digest('hex'));
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({reference:body.reference}));
 });
 server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const Adapter=require('../src/adapters/bankRailAdapter');
  const adapter=new Adapter({name:'LOCAL_TEST',endpoint:`http://127.0.0.1:${server.address().port}`,apiKey:'test-key',secret:'test-secret'});
  registry.registerRailAdapter('LOCAL_TEST','NG',adapter);
  const selected=registry.getRailAdapter('LOCAL_TEST',{country_code:'NG'});
  await selected.sendTransfer({from:'TEST_FROM',to:'TEST_TO',amount:'1.00',reference:'test_ref_001'});
  await selected.sendTransfer({from:'TEST_FROM',to:'TEST_TO',amount:'1.00',reference:'test_ref_001'});
  assert.equal(requests.length,2);assert.equal(requests[0].headers['idempotency-key'],requests[1].headers['idempotency-key']);
  assert.throws(()=>registry.getRailAdapter('LOCAL_TEST','GH'),/NOT_CONFIGURED/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('generic QSE payload context verifies P-256 signatures and rejects context tampering',()=>{
 const key=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=key.publicKey.export({format:'jwk'});
 const pub=Buffer.concat([Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
 for(const size of [32,64,100]){
  const payload=crypto.randomBytes(size);
  const tx={payload_raw:payload.toString('hex'),sessionNonce:'11'.repeat(8),counter:42,prevHash:'22'.repeat(32),peerPubKey:pub.toString('hex'),peerID:'33'.repeat(8),merkleRoot:'44'.repeat(32)};
  const message=qse.buildPayloadContext(tx);
  const counter=Buffer.alloc(4);counter.writeUInt32LE(42);
  const expected=Buffer.concat([payload,Buffer.from(tx.sessionNonce,'hex'),counter,Buffer.from(tx.prevHash,'hex'),pub,Buffer.from(tx.peerID,'hex'),payload.subarray(24,32),Buffer.from(tx.merkleRoot,'hex')]);
  assert.deepEqual(message,expected);
  tx.signature=crypto.sign('sha256',message,{key:key.privateKey,dsaEncoding:'ieee-p1363'}).toString('hex');
  assert.equal(verifyTransaction(tx,pub),true);
  assert.throws(()=>verifyTransaction({...tx,counter:43},pub),/SIGNATURE/);
  assert.throws(()=>verifyTransaction({...tx,peerID:'55'.repeat(8)},pub),/SIGNATURE/);
  assert.throws(()=>verifyTransaction({...tx,amount:payload.readUInt32LE(0)+1},pub),/SIGNED_AMOUNT_MISMATCH/);
  assert.equal(verifyTransaction({...tx,timestamp:payload.readUInt32LE(4)},pub),true);
  assert.throws(()=>verifyTransaction({...tx,timestamp:payload.readUInt32LE(4)+1},pub),/SIGNED_TIMESTAMP_MISMATCH/);
  assert.equal(qse.verifyPayload(message,message.length,tx.signature,Buffer.alloc(64),tx.peerID),false);
 }
 assert.throws(()=>qse.buildPayloadContext({payload_raw:'00'.repeat(101)}),/INVALID_PAYLOAD/);
});
test('routing, payout and ingestion modules load with the resolved interfaces',async()=>{
 assert.equal(typeof require('../src/services/routingEngine').resolveRoute,'function');
 assert.equal(typeof require('../src/services/p2pIngestionEngine').ingestP2PTransaction,'function');
 assert.equal(typeof require('../src/services/payoutEngine').queuePayout,'function');
 await require('../src/db').end();
});
