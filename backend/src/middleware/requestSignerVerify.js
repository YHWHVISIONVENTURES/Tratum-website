const crypto = require('node:crypto');

// Must follow institutionAuth, which authenticates against the stored key hash.
module.exports = function requestSignerVerify(req, res, next) {
  const signature = req.headers['x-signature'];
  const timestamp = req.headers['x-timestamp'];
  const apiKey = req.headers['x-api-key'];
  if (!req.institution || typeof apiKey !== 'string' ||
      typeof timestamp !== 'string' || typeof signature !== 'string') {
    return res.status(401).json({ error: 'MISSING_SIGNATURE_HEADERS' });
  }
  if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000) {
    return res.status(403).json({ error: 'TIMESTAMP_REJECTED' });
  }
  if (!/^[a-fA-F0-9]{64}$/.test(signature)) {
    return res.status(403).json({ error: 'INVALID_SIGNATURE' });
  }
  const body = req.method === 'GET' ? '{}' : JSON.stringify(req.body || {});
  const expected = crypto.createHmac('sha256', apiKey)
    .update(`${timestamp}.${apiKey}.${body}`).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
    return res.status(403).json({ error: 'INVALID_SIGNATURE' });
  }
  return next();
};
