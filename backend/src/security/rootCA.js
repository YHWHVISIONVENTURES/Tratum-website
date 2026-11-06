const crypto = require('crypto');
const fs = require('fs');

class RootCaUnavailableError extends Error {
  constructor() {
    super('ROOT_CA_UNAVAILABLE');
    this.code = 'ROOT_CA_UNAVAILABLE';
  }
}

function loadRootCa() {
  const privatePath = process.env.TRATUM_ROOT_CA_PRIVATE_KEY_PATH;
  const certificatePath = process.env.TRATUM_ROOT_CA_CERTIFICATE_PATH;
  if (!privatePath || !certificatePath) throw new RootCaUnavailableError();

  let privatePem;
  let certificatePem;
  try {
    privatePem = fs.readFileSync(privatePath, 'utf8');
    certificatePem = fs.readFileSync(certificatePath, 'utf8');
  } catch {
    throw new RootCaUnavailableError();
  }

  let privateKey;
  let certificatePublicKey;
  try {
    privateKey = crypto.createPrivateKey(privatePem);
    certificatePublicKey = crypto.createPublicKey(certificatePem);
  } catch {
    throw new RootCaUnavailableError();
  }

  const details = privateKey.asymmetricKeyDetails || {};
  const publicDetails = certificatePublicKey.asymmetricKeyDetails || {};
  if (privateKey.asymmetricKeyType !== 'ec' ||
      certificatePublicKey.asymmetricKeyType !== 'ec' ||
      details.namedCurve !== 'prime256v1' ||
      publicDetails.namedCurve !== 'prime256v1') {
    throw new RootCaUnavailableError();
  }

  const derivedPublicKey = crypto.createPublicKey(privateKey);
  const derivedDer = derivedPublicKey.export({ type: 'spki', format: 'der' });
  const certificateDer = certificatePublicKey.export({ type: 'spki', format: 'der' });
  if (!derivedDer.equals(certificateDer)) throw new RootCaUnavailableError();

  return { privateKey, publicKey: certificatePublicKey };
}

function signPayload(payload, privateKey) {
  if (!Buffer.isBuffer(payload) || !privateKey) throw new TypeError('INVALID_SIGNING_INPUT');
  return crypto.sign('sha256', payload, {
    key: privateKey,
    dsaEncoding: 'ieee-p1363'
  });
}

function verifyPayload(payload, signature, publicKey) {
  if (!Buffer.isBuffer(payload) || !Buffer.isBuffer(signature) ||
      signature.length !== 64 || !publicKey) return false;
  return crypto.verify('sha256', payload, {
    key: publicKey,
    dsaEncoding: 'ieee-p1363'
  }, signature);
}

module.exports = { loadRootCa, signPayload, verifyPayload, RootCaUnavailableError };
