const QuantumSecureEngine = require('../crypto/QuantumSecureEngine');

function verifyTransaction(tx, pubKey) {

  if (
    !tx.payload_raw ||
    !tx.sessionNonce ||
    tx.counter === undefined ||
    !tx.prevHash ||
    !tx.peerPubKey ||
    !tx.merkleRoot
  ) {
    throw new Error('INCOMPLETE_CRYPTO_CONTEXT');
  }

  const buffer = Buffer.concat([
    Buffer.from(tx.payload_raw, 'hex'),
    Buffer.from(tx.sessionNonce, 'hex'),
    u32ToBuffer(tx.counter),
    Buffer.from(tx.prevHash, 'hex'),
    Buffer.from(tx.peerPubKey, 'hex'),
    Buffer.from(tx.senderID, 'hex'),
    Buffer.from(tx.merkleRoot, 'hex')
  ]);

  const valid = QuantumSecureEngine.verifyPayload(
    buffer,
    buffer.length,
    Buffer.from(tx.signature, 'hex'),
    Buffer.from(pubKey, 'hex'),
    Buffer.from(tx.senderID, 'hex')
  );

  if (!valid) {
    throw new Error('SIGNATURE_VERIFICATION_FAILED');
  }

  return true;
}

module.exports = {
  verifyTransaction
};