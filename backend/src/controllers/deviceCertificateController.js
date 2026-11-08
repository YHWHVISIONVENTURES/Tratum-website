const crypto = require('crypto');
const pool = require('../db');
const { loadRootCa, signPayload, verifyPayload } = require('../security/rootCA');

function isValidDeviceId(deviceId) {
  return typeof deviceId === 'string' && /^[A-Fa-f0-9]{16}$/.test(deviceId);
}

exports.revokeDevice = async (req, res) => {
  let client;
  let transactionStarted = false;
  try {
    const { device_id: deviceId, reason } = req.body || {};
    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({ ok: false, error: 'INVALID_DEVICE_ID' });
    }

    const rootCa = loadRootCa();
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;

    const existing = await client.query(
      `SELECT status FROM device_registry WHERE device_id=$1 FOR UPDATE`,
      [deviceId.toUpperCase()]
    );
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ ok: false, error: 'DEVICE_NOT_FOUND' });
    }
    if (existing.rows[0].status === 'REVOKED') {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ ok: false, error: 'ALREADY_REVOKED' });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const expiry = timestamp + 365 * 24 * 60 * 60;
    const payload = Buffer.alloc(16);
    Buffer.from(deviceId, 'hex').copy(payload, 0);
    payload.writeUInt32LE(timestamp, 8);
    payload.writeUInt32LE(expiry, 12);
    const signature = signPayload(payload, rootCa.privateKey);

    await client.query(
      `INSERT INTO device_revocations (device_id, timestamp, expiry, signature, reason)
       VALUES ($1,$2,$3,$4,$5)`,
      [deviceId.toUpperCase(), timestamp, expiry, signature.toString('base64'), reason || 'ADMIN_REVOKE']
    );
    await client.query(
      `UPDATE device_registry SET status='REVOKED' WHERE device_id=$1`,
      [deviceId.toUpperCase()]
    );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, target_id, metadata)
       VALUES ($1,'DEVICE_REVOKED',$2,$3)`,
      [String(req.admin?.id || 'SYSTEM'), deviceId.toUpperCase(), JSON.stringify({ reason: reason || 'ADMIN_REVOKE' })]
    );
    await client.query('COMMIT');
    transactionStarted = false;

    return res.json({ ok: true, device_id: deviceId.toUpperCase(), timestamp, expiry, signature: signature.toString('base64') });
  } catch (err) {
    if (transactionStarted && client) await client.query('ROLLBACK').catch(() => {});
    const unavailable = err.code === 'ROOT_CA_UNAVAILABLE';
    return res.status(unavailable ? 503 : 500).json({
      ok: false,
      error: unavailable ? 'DEVICE_CA_UNAVAILABLE' : 'DEVICE_REVOCATION_FAILED'
    });
  } finally {
    if (client) client.release();
  }
};

exports.suspendDevice = async (req, res) => {
  const client = await pool.connect();
  try {
    const { device_id: deviceId } = req.body || {};
    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({ ok: false, error: 'INVALID_DEVICE_ID' });
    }
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT status FROM device_registry WHERE device_id=$1 FOR UPDATE`,
      [deviceId.toUpperCase()]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'DEVICE_NOT_FOUND' });
    }
    if (['REVOKED', 'BLACKLISTED'].includes(result.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'INVALID_STATE_TRANSITION' });
    }
    await client.query(`UPDATE device_registry SET status='SUSPENDED' WHERE device_id=$1`, [deviceId.toUpperCase()]);
    await client.query(
      `INSERT INTO audit_log (actor_id, action, target_id, metadata) VALUES ($1,'DEVICE_SUSPENDED',$2,$3)`,
      [String(req.admin?.id || 'SYSTEM'), deviceId.toUpperCase(), JSON.stringify({})]
    );
    await client.query('COMMIT');
    return res.json({ ok: true, device_id: deviceId.toUpperCase(), status: 'SUSPENDED' });
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ ok: false, error: 'DEVICE_SUSPENSION_FAILED' });
  } finally {
    client.release();
  }
};

function isValidPublicKey(value) {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{128}$/.test(value)) return false;
  try {
    // SPKI for id-ecPublicKey / prime256v1 and an uncompressed point.
    const prefix = Buffer.from('3059301306072A8648CE3D020106082A8648CE3D03010703420004', 'hex');
    const key = crypto.createPublicKey({
      key: Buffer.concat([prefix, Buffer.from(value, 'hex')]),
      format: 'der',
      type: 'spki'
    });
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch {
    return false;
  }
}exports.rotateKeypair = async (req, res) => {
  // Do not desynchronize server and device identity until firmware supports
  // a device-signed rotation proof and certificate update.
  return res.status(409).json({
    ok: false,
    error: 'DEVICE_KEY_ROTATION_REQUIRES_DEVICE_PROOF'
  });
};exports.getDeviceStatus = async (req, res) => {
  try {
    const { device_id: deviceId } = req.params;
    if (!isValidDeviceId(deviceId)) return res.status(400).json({ ok: false, error: 'INVALID_DEVICE_ID_FORMAT' });
    const result = await pool.query(`SELECT status FROM device_registry WHERE device_id=$1`, [deviceId.toUpperCase()]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'DEVICE_NOT_FOUND' });
    return res.json({ ok: true, device_id: deviceId.toUpperCase(), status: result.rows[0].status });
  } catch {
    return res.status(500).json({ ok: false, error: 'DEVICE_STATUS_UNAVAILABLE' });
  }
};

exports.getRevocations = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT device_id, timestamp, expiry, signature FROM device_revocations ORDER BY timestamp DESC LIMIT 1000`
    );
    return res.json({ ok: true, revocations: result.rows });
  } catch {
    return res.status(500).json({ ok: false, error: 'REVOCATION_LIST_UNAVAILABLE' });
  }
};
