const crypto = require('crypto');

function cryptoVerify(hash, signature, publicKey) {
  try {
    const verifier = crypto.createVerify('sha256');
    verifier.update(Buffer.from(hash));
    verifier.end();

    return verifier.verify(publicKey, Buffer.from(signature, 'hex'));
  } catch (e) {
    return false;
  }
}

function verifyProofHash(proof) {
  const crypto = require('crypto');

  const ledgerBuf = Buffer.alloc(4);
  ledgerBuf.writeUInt32BE(Number(proof.ledger_count));

  const timestampBuf = Buffer.alloc(8);
  timestampBuf.writeBigUInt64BE(BigInt(proof.timestamp));

  const input = Buffer.concat([
    Buffer.from(proof.device_id),
    ledgerBuf,
    Buffer.from(proof.merkle_root, 'hex'),
    Buffer.from(proof.prev_merkle_root || '', 'hex'),
    timestampBuf
  ]);

  return crypto.createHash('sha256').update(input).digest('hex');
}

module.exports = {
  cryptoVerify,
  verifyProofHash
};