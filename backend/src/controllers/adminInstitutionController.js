const pool = require('../db');
const crypto = require('crypto');

// HELPER: Defined here so it can be called below
function generateApiKey(namePrefix) {
  const secret = crypto.randomBytes(32).toString('hex');
  const rawKey = `${namePrefix}.${secret}`;
  const hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');
  return { rawKey, hashedKey };
}

// =====================================
// CREATE NEW INSTITUTION
// =====================================
exports.createInstitution = async (req, res) => {
  try {
    const { name, type, public_key, country_code } = req.body;

    if (typeof name !== 'string' || !name.trim() || name.length > 200 || !['BANK','CENTRAL_BANK','FINTECH','ENTERPRISE'].includes(type) || (country_code && !/^[A-Z]{2,3}$/.test(country_code)) || (public_key !== undefined && public_key !== null && typeof public_key !== 'string')) {
      return res.status(400).json({ ok: false, error: "NAME_AND_TYPE_REQUIRED" });
    }

    // 1. GENERATE SECURE KEY PAIR
    // Now this call finds the function defined above
    const { rawKey, hashedKey } = generateApiKey(name.replace(/\s+/g, '_').toLowerCase());

    // 2. INSERT HASHED KEY INTO DB
    const result = await pool.query(
      `INSERT INTO institutions
       (name, type, api_key, public_key, country_code, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING institution_id AS id, name, type, created_at`,
      [name, type, hashedKey, public_key || null, country_code || null]
    );

    // 3. RETURN RAW KEY ONLY ONCE
    return res.json({
      ok: true,
      institution: result.rows[0],
      api_key_raw: rawKey
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: 'INSTITUTION_OPERATION_UNAVAILABLE' });
  }
};

// =====================================
// DISABLE INSTITUTION
// =====================================
exports.disableInstitution = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE institutions SET status='disabled' WHERE institution_id=$1`,
      [id]
    );
    return res.json({ ok: true, status: "DISABLED" });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'INSTITUTION_OPERATION_UNAVAILABLE' });
  }
};

// =====================================
// LIST INSTITUTIONS
// =====================================
exports.listInstitutions = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT institution_id AS id, name, type, status, created_at FROM institutions ORDER BY id ASC`
    );
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'INSTITUTION_OPERATION_UNAVAILABLE' });
  }
};
