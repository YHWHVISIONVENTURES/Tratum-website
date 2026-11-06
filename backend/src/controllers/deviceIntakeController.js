const pool = require('../db');

exports.listIntakes = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, serial_number, customer_ref, institution_id, status, created_at, updated_at
       FROM device_intakes ORDER BY created_at DESC LIMIT 200`
    );
    return res.json({ ok: true, intakes: result.rows });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'DEVICE_INTAKES_UNAVAILABLE' });
  }
};

exports.createIntake = async (req, res) => {
  const serialNumber = String(req.body?.serial_number || '').trim();
  const customerRef = String(req.body?.customer_ref || '').trim();
  const institutionId = req.body?.institution_id ? String(req.body.institution_id).trim() : null;

  if (!serialNumber || serialNumber.length > 128 || !customerRef || customerRef.length > 128) {
    return res.status(400).json({ ok: false, error: 'SERIAL_NUMBER_AND_CUSTOMER_REF_REQUIRED' });
  }
  if (institutionId && institutionId.length > 128) {
    return res.status(400).json({ ok: false, error: 'INVALID_INSTITUTION_ID' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO device_intakes (serial_number, customer_ref, institution_id, created_by_admin_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, serial_number, customer_ref, institution_id, status, created_at, updated_at`,
      [serialNumber, customerRef, institutionId, String(req.admin.id)]
    );
    const intake = result.rows[0];

    await client.query(
      `INSERT INTO audit_log (actor_id, action, target_id, metadata)
       VALUES ($1, 'DEVICE_INTAKE_RECORDED', $2, $3)`,
      [String(req.admin.id), String(intake.id), JSON.stringify({ serial_number: serialNumber, institution_id: institutionId })]
    );
    await client.query('COMMIT');
    return res.status(201).json({ ok: true, intake });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) { /* preserve the original database error */ }
    }
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'SERIAL_NUMBER_ALREADY_INTAKEN' });
    }
    return res.status(500).json({ ok: false, error: 'DEVICE_INTAKE_CREATE_FAILED' });
  } finally {
    if (client) client.release();
  }
};