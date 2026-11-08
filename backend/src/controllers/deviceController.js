const crypto = require('crypto');
const pool = require('../db');
const { loadRootCa, signPayload, verifyPayload } = require('../security/rootCA');

const {
  deriveDeviceId
} = require('../services/deviceIdentityEngine');

// -----------------------------------------------------
// HELPERS
// -----------------------------------------------------
function sha256(data) {
  return crypto
    .createHash('sha256')
    .update(data)
    .digest();
}

function isValidHex(str) {
  return /^[0-9a-fA-F]+$/.test(str);
}

// -----------------------------------------------------
// DEVICE PROVISIONING
// POST /device/provision
// -----------------------------------------------------
exports.provisionDevice = async (req, res) => {

  let client = null;
  let transactionStarted = false;
  try {
    const rootCa = loadRootCa();
    client = await pool.connect();

    const {
      device_id,
      public_key,
      issuer_id,
      deployment_class,
      alias,
      geo_code,
      firmware_version,
      metadata
    } = req.body;

    // -------------------------------------------------
    // VALIDATION
    // -------------------------------------------------
    if (
      !device_id ||
      !public_key ||
      !issuer_id
    ) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_PROVISION_REQUEST'
      });
    }

    if (
      device_id.length !== 16 ||
      !isValidHex(device_id)
    ) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_DEVICE_ID'
      });
    }

    if (
      public_key.length !== 128 ||
      !isValidHex(public_key)
    ) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_PUBLIC_KEY'
      });
    }

    // -------------------------------------------------
    // DERIVATION VERIFICATION
    // -------------------------------------------------
    const derived =
      deriveDeviceId(public_key);

    if (derived !== device_id.toUpperCase()) {

      return res.status(400).json({
        ok: false,
        error: 'DEVICE_ID_MISMATCH'
      });
    }

    // -------------------------------------------------
    // ISSUER VALIDATION
    // -------------------------------------------------
    const issuer = await client.query(
      `
      SELECT 1
      FROM institutions
      WHERE institution_id=$1
      LIMIT 1
      `,
      [issuer_id]
    );

    if (!issuer.rows.length) {

      return res.status(403).json({
        ok: false,
        error: 'INVALID_ISSUER'
      });
    }

    // -------------------------------------------------
    // IDEMPOTENCY
    // -------------------------------------------------
    const existing = await client.query(
      `
      SELECT 1
      FROM device_registry
      WHERE device_id=$1
      LIMIT 1
      `,
      [device_id]
    );

    if (existing.rows.length) {

      return res.status(409).json({
        ok: false,
        error: 'DEVICE_ALREADY_EXISTS'
      });
    }

    // -------------------------------------------------
    // CERTIFICATE BODY
    // -------------------------------------------------
    const issued_at = Date.now();

    const expiry_at =
      issued_at +
      (365 * 24 * 60 * 60 * 1000);

    const certificate = {
      version: 1,
      authority: 'TRATUM_ROOT_CA',
      device_id,
      issuer_id,
      deployment_class:
        deployment_class || 'RETAIL',
      alias: alias || null,
      geo_code: geo_code || null,
      firmware_version:
        firmware_version || null,
      public_key,
      issued_at,
      expiry_at,
      metadata: metadata || {}
    };

    // -------------------------------------------------
    // FIRMWARE-ALIGNED HASH
    // HASH(pubKey + device_id)
    // -------------------------------------------------
    const payload = Buffer.concat([
      Buffer.from(public_key, 'hex'),
      Buffer.from(device_id, 'hex')
    ]);

    const certHash = sha256(payload);

    // -------------------------------------------------
    // SIGN CERTIFICATE
    // -------------------------------------------------
    const signature = signPayload(payload, rootCa.privateKey);

    // -------------------------------------------------
    // INTERNAL VERIFY
    // -------------------------------------------------
    const valid =
      verifyPayload(payload, signature, rootCa.publicKey);

    if (!valid) {

      return res.status(500).json({
        ok: false,
        error: 'CERT_SIGNATURE_FAILED'
      });
    }

    // -------------------------------------------------
    // STORE
    // -------------------------------------------------
    await client.query('BEGIN');
    transactionStarted = true;

    // devices
    await client.query(
      `
      INSERT INTO devices
      (
        device_id,
        public_key,
        issuer_id,
        firmware_version,
        status,
        ledger_count
      )
      VALUES ($1,$2,$3,$4,'ACTIVE',0)
      `,
      [
        device_id,
        public_key,
        issuer_id,
        firmware_version || null
      ]
    );

    // registry
    await client.query(
      `
      INSERT INTO device_registry
      (
        device_id,
        alias,
        issuer_id,
        deployment_class,
        certificate_hash,
        certificate_signature,
        status,
        geo_code
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,'ACTIVE',$7)
      `,
      [
        device_id,
        alias || null,
        issuer_id,
        deployment_class || 'RETAIL',
        certHash.toString('hex'),
        signature.toString('hex'),
        geo_code || null
      ]
    );

    // certificate ledger
    await client.query(
      `
      INSERT INTO certificate_records
      (
        device_id,
        public_key,
        issuer_id,
        certificate_hash,
        signature,
        certificate_body,
        issued_at,
        expiry_at,
        status,
        root_ca_version
      )
      VALUES
      (
        $1,$2,$3,$4,$5,$6,$7,$8,
        'ACTIVE',
        'v1'
      )
      `,
      [
        device_id,
        public_key,
        issuer_id,
        certHash.toString('hex'),
        signature.toString('hex'),
        certificate,
        issued_at,
        expiry_at
      ]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    return res.json({
      ok: true,
      device_id,
      certificate,
      certificate_hash:
        certHash.toString('hex'),
      signature:
        signature.toString('hex'),
      root_public_key: rootCa.publicKey.export({ type: 'spki', format: 'pem' })
    });

  } catch (err) {

    if (transactionStarted && client) await client.query('ROLLBACK').catch(() => {});
    const unavailable = err.code === 'ROOT_CA_UNAVAILABLE';
    return res.status(unavailable ? 503 : 500).json({
      ok: false,
      error: unavailable ? 'DEVICE_CA_UNAVAILABLE' : 'DEVICE_PROVISIONING_FAILED'
    });
  } finally {
    if (client) client.release();
  }
};

// -----------------------------------------------------
// VERIFY CERTIFICATE
// -----------------------------------------------------
exports.verifyDeviceCertificate =
async (req, res) => {

  try {

    const {
      public_key,
      device_id,
      signature
    } = req.body || {};
    if (!/^[0-9a-fA-F]{128}$/.test(public_key || '') ||
        !/^[0-9a-fA-F]{16}$/.test(device_id || '') ||
        !/^[0-9a-fA-F]{128}$/.test(signature || '')) {
      return res.status(400).json({ ok: false, error: 'INVALID_CERTIFICATE_REQUEST' });
    }
    const rootCa = loadRootCa();

    const payload = Buffer.concat([
      Buffer.from(public_key, 'hex'),
      Buffer.from(device_id, 'hex')
    ]);

    const ok = verifyPayload(payload, Buffer.from(signature, 'hex'), rootCa.publicKey);

    return res.json({
      ok
    });

  } catch (err) {
    const unavailable = err.code === 'ROOT_CA_UNAVAILABLE';
    return res.status(unavailable ? 503 : 500).json({
      ok: false,
      error: unavailable ? 'DEVICE_CA_UNAVAILABLE' : 'CERTIFICATE_VERIFICATION_FAILED'
    });
  }
};
