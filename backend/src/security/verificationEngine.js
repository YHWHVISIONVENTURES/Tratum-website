const QuantumSecureEngine = require('../crypto/QuantumSecureEngine');

// Verify the complete generic payload context produced by firmware signPayload.
// Certificate, nonce replay, ledger and policy gates remain in the ingestion engine.
function verifyTransaction(tx, publicKey) {
  if (!tx || !tx.peerID) throw new Error('EXPLICIT_PEER_ID_REQUIRED');
  const message = QuantumSecureEngine.buildPayloadContext(tx);
  const payload = Buffer.from(tx.payload_raw, 'hex');
  if (tx.amount !== undefined && (!Number.isSafeInteger(Number(tx.amount)) || Number(tx.amount) !== payload.readUInt32LE(0))) throw new Error('SIGNED_AMOUNT_MISMATCH');
  if (tx.timestamp !== undefined) {
    const timestamp = Number(tx.timestamp), signedTimestamp = payload.readUInt32LE(4);
    if (!Number.isSafeInteger(timestamp) || (timestamp !== signedTimestamp && timestamp !== signedTimestamp * 1000)) throw new Error('SIGNED_TIMESTAMP_MISMATCH');
  }
  for (const [field,offset] of [['senderID',8],['receiverID',16]]) {
    if (tx[field] !== undefined && (typeof tx[field] !== 'string' || !/^[a-fA-F0-9]{16}$/.test(tx[field]) || tx[field].toLowerCase() !== payload.subarray(offset,offset+8).toString('hex'))) throw new Error('SIGNED_PARTICIPANT_MISMATCH');
  }
  if (tx.nonce !== undefined) {
    if ((typeof tx.nonce === 'number' && !Number.isSafeInteger(tx.nonce)) || !/^(0|[1-9][0-9]*)$/.test(String(tx.nonce)) || BigInt(tx.nonce) !== payload.readBigUInt64LE(24)) throw new Error('SIGNED_NONCE_MISMATCH');
  }
  if (!QuantumSecureEngine.verifyPayload(message, message.length, tx.signature, publicKey, tx.peerID)) {
    throw new Error('SIGNATURE_VERIFICATION_FAILED');
  }
  return true;
}
module.exports = { verifyTransaction };
