const crypto = require('crypto');

function deriveDeviceId(publicKeyHex) {

  const pub = Buffer.from(publicKeyHex, 'hex');

  const hash = crypto
    .createHash('sha256')
    .update(pub)
    .digest();

  return hash
    .subarray(0, 8)
    .toString('hex')
    .toUpperCase();
}

module.exports = {
  deriveDeviceId
};