const crypto = require('crypto');
const pool = require('../db');

exports.verifyRailSignature = async (payload, signature) => {
  const secret = process.env.RAIL_SECRET;
  const { timestamp, nonce } = payload;

  // 1. TIMESTAMPS: 5-Minute Window Lock
  // Prevents "Expired" transactions from being re-processed
  const now = Date.now();
  const requestTime = Number(timestamp);
  if (!requestTime || Math.abs(now - requestTime) > 300000) {
    return { valid: false, error: 'TIMESTAMP_EXPIRED' };
  }

  // 2. NONCE: Idempotency Check
  // Prevents "Replay Attacks" (using the same signature twice)
  const existingNonce = await pool.query(
    'SELECT id FROM processed_nonces WHERE nonce = $1 LIMIT 1',
    [nonce]
  );
  if (existingNonce.rows.length) {
    return { valid: false, error: 'NONCE_REPLAY_DETECTED' };
  }

  // 3. CANONICAL HASHING
  const data = { ...payload };
  delete data.signature;

  const ordered = Object.keys(data).sort().reduce((obj, key) => {
    obj[key] = data[key];
    return obj;
  }, {});

  const computed = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(ordered))
    .digest('hex');

  // 4. TIMING-SAFE COMPARISON
  const isValid = crypto.timingSafeEqual(
    Buffer.from(computed, 'hex'),
    Buffer.from(signature, 'hex')
  );

  if (!isValid) return { valid: false, error: 'INVALID_SIGNATURE' };

  // 5. COMMIT NONCE
  // Save the nonce so it can never be used again
  await pool.query(
    'INSERT INTO processed_nonces (nonce, expires_at) VALUES ($1, to_timestamp($2))',
    [nonce, (now + 600000) / 1000] // Auto-expire from DB after 10 mins
  );

  return { valid: true };
};
