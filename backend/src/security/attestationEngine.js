const crypto = require('crypto');

function buildAttestationHash({
  challenge,
  nonce
}) {

  const challengeBuf =
    Buffer.from(challenge, 'hex');

  const nonceBuf =
    Buffer.from(nonce, 'hex');

  const payload =
    Buffer.concat([
      challengeBuf,
      nonceBuf
    ]);

  return crypto
    .createHash('sha256')
    .update(payload)
    .digest();
}

function buildReportHash({
  device_pubkey,
  firmware_hash,
  nonce,
  secure_boot
}) {

  const payload = Buffer.concat([
    Buffer.from(device_pubkey, 'hex'),
    Buffer.from(firmware_hash, 'hex'),
    Buffer.from(nonce, 'hex'),
    Buffer.from([secure_boot ? 1 : 0])
  ]);

  return crypto
    .createHash('sha256')
    .update(payload)
    .digest();
}

module.exports = {
  buildAttestationHash,
  buildReportHash
};