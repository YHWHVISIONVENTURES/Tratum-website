const crypto = require('crypto');
const pool = require('../db');

module.exports = async function institutionAuth(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'];

    if (typeof apiKey !== 'string' || !apiKey || apiKey.length>512) {
      return res.status(401).json({ error: 'MISSING_API_KEY' });
    }

    const hashed = crypto
      .createHash('sha256')
      .update(apiKey)
      .digest('hex');

    const result = await pool.query(
      `SELECT * FROM institutions WHERE api_key=$1 AND status='active'`,
      [hashed]
    );

    if (!result.rows.length) {
      return res.status(403).json({ error: 'INVALID_API_KEY' });
    }

    req.institution = result.rows[0];
    next();

  } catch (err) {
    return res.status(503).json({ error: 'INSTITUTION_AUTH_UNAVAILABLE' });
  }
};
