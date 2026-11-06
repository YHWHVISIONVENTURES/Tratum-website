const crypto = require('crypto');
const pool = require('../db');
const fs = require('fs');
const path = require('path');

// Simple in-memory rate limiter for attestation attempts
const attestRateMap = new Map();

const ROOT_PRIVATE_KEY = fs.readFileSync(
  path.join(__dirname, '../../keys/root_private.pem'),
  'utf8'
);

const {
  buildAttestationHash,
  buildReportHash
} = require('../security/attestationEngine');


function tooManyRequests(deviceId) {
  const now = Date.now();
  const record = attestRateMap.get(deviceId) || { count: 0, start: now };
  if (now - record.start > 60000) { record.count = 0; record.start = now; }
  record.count++;
  attestRateMap.set(deviceId, record);
  return record.count > 5; // Limit to 5 attempts per minute
}

function verifyRootSignature(hash, signature) {

  const verifier =
    crypto.createVerify('SHA256');

  verifier.update(hash);
  verifier.end();

  return verifier.verify(
    ROOT_PRIVATE_KEY,
    Buffer.from(signature, 'base64')
  );
}

exports.initAttestation = async (req, res) => {

  try {

    const { device_id } = req.body;

    if (!device_id) {
      return res.status(400).json({
        ok: false,
        error: 'DEVICE_ID_REQUIRED'
      });
    }

    const device = await pool.query(
      `
      SELECT public_key, status
      FROM devices
      WHERE device_id=$1
      LIMIT 1
      `,
      [device_id]
    );

    if (!device.rows.length) {
      return res.status(404).json({
        ok: false,
        error: 'DEVICE_NOT_FOUND'
      });
    }

    if (device.rows[0].status !== 'ACTIVE') {
      return res.status(403).json({
        ok: false,
        error: 'DEVICE_BLOCKED'
      });
    }

    const challenge =
      crypto.randomBytes(32).toString('hex');

    const nonce =
      crypto.randomBytes(16).toString('hex');

    const expires_at =
      Date.now() + 60000;

    await pool.query(
      `
      INSERT INTO device_attestations (
        device_id,
        challenge,
        nonce,
        public_key,
        expires_at,
        attestation_signature
      )
      VALUES ($1,$2,$3,$4,$5,'PENDING')
      `,
      [
        device_id,
        challenge,
        nonce,
        device.rows[0].public_key,
        expires_at
      ]
    );

    return res.json({
      ok: true,
      challenge,
      nonce,
      expires_at
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};

exports.completeAttestation = async (req, res) => {

  const client = await pool.connect();

  try {

    const {
      device_id,
      signature,
      firmware_hash,
      secure_boot,
      device_pubkey,
      nonce,
      certificate,
      certificate_signature
    } = req.body;

    // --------------------------------------------------
    // BASIC VALIDATION
    // --------------------------------------------------
    if (
      !device_id ||
      !signature ||
      !firmware_hash ||
      !device_pubkey ||
      !nonce ||
      !certificate ||
      !certificate_signature
    ) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_ATTESTATION_PAYLOAD'
      });
    }

    await client.query('BEGIN');

    // --------------------------------------------------
    // LOAD DEVICE
    // --------------------------------------------------
    const device = await client.query(
      `
      SELECT
        d.public_key,
        d.status,
        r.certificate_signature,
        r.certificate_hash
      FROM devices d
      JOIN device_registry r
      ON r.device_id = d.device_id
      WHERE d.device_id=$1
      LIMIT 1
      `,
      [device_id]
    );

    if (!device.rows.length) {
      throw new Error('DEVICE_NOT_REGISTERED');
    }

    const row = device.rows[0];

    // --------------------------------------------------
    // DEVICE STATUS
    // --------------------------------------------------
    if (row.status !== 'ACTIVE') {
      throw new Error('DEVICE_BLOCKED');
    }

    // --------------------------------------------------
    // VERIFY PUBKEY BINDING
    // --------------------------------------------------
    if (row.public_key !== device_pubkey) {
      throw new Error('PUBKEY_MISMATCH');
    }

    // --------------------------------------------------
    // LOAD CHALLENGE
    // --------------------------------------------------
    const challengeRecord = await client.query(
      `
      SELECT *
      FROM device_attestation_challenges
      WHERE device_id=$1
      AND used=false
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [device_id]
    );

    if (!challengeRecord.rows.length) {
      throw new Error('NO_ACTIVE_CHALLENGE');
    }

    const challenge =
      challengeRecord.rows[0];

    // --------------------------------------------------
    // EXPIRY
    // --------------------------------------------------
    if (
      Number(challenge.expires_at)
      < Date.now()
    ) {
      throw new Error('ATTESTATION_EXPIRED');
    }

    // --------------------------------------------------
    // NONCE MATCH
    // --------------------------------------------------
    if (challenge.nonce !== nonce) {
      throw new Error('NONCE_MISMATCH');
    }

    // --------------------------------------------------
    // VERIFY CERTIFICATE SIGNATURE
    // --------------------------------------------------
    const canonical =
      JSON.stringify(certificate);

    const certHash =
      crypto
        .createHash('sha256')
        .update(canonical)
        .digest();

    const certValid =
      verifyRootSignature(
        certHash,
        certificate_signature
      );

    if (!certValid) {
      throw new Error(
        'INVALID_CERTIFICATE_SIGNATURE'
      );
    }

    // --------------------------------------------------
    // VERIFY CHALLENGE SIGNATURE
    // Firmware:
    // SHA256(challenge || nonce)
    // --------------------------------------------------
    const attestationHash =
      buildAttestationHash({
        challenge: challenge.challenge,
        nonce
      });

    const verifier =
      crypto.createVerify('SHA256');

    verifier.update(attestationHash);
    verifier.end();

    const signatureValid =
      verifier.verify(
        device_pubkey,
        Buffer.from(signature, 'base64')
      );

    if (!signatureValid) {
      throw new Error(
        'INVALID_ATTESTATION_SIGNATURE'
      );
    }

    // --------------------------------------------------
    // VERIFY FIRMWARE REPORT
    // --------------------------------------------------
    const reportHash =
      buildReportHash({
        device_pubkey,
        firmware_hash,
        nonce,
        secure_boot
      });

    // --------------------------------------------------
    // SECURE BOOT ENFORCEMENT
    // --------------------------------------------------
    if (
      Number(secure_boot) !== 1
    ) {
      throw new Error(
        'SECURE_BOOT_REQUIRED'
      );
    }

    await client.query(
 `
 INSERT INTO device_trust_state (
    device_id,
    attestation_status,
    attestation_token,
    token_issued_at,
    token_expiry,
    last_attested_at,
    firmware_hash,
    secure_boot,
    attested_public_key,
    key_epoch,
    updated_at
 )
 VALUES (
    $1,
    'VERIFIED',
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8,
    $9,
    NOW()
 )
 ON CONFLICT (device_id)
 DO UPDATE SET

    attestation_status='VERIFIED',
    attestation_token=EXCLUDED.attestation_token,
    token_issued_at=EXCLUDED.token_issued_at,
    token_expiry=EXCLUDED.token_expiry,
    last_attested_at=EXCLUDED.last_attested_at,
    firmware_hash=EXCLUDED.firmware_hash,
    secure_boot=EXCLUDED.secure_boot,
    attested_public_key=EXCLUDED.attested_public_key,
    key_epoch=EXCLUDED.key_epoch,
    updated_at=NOW()
 `,
 [
    device_id,
    sessionToken,
    issuedAt,
    expiry,
    issuedAt,
    firmwareHash,
    secureBoot,
    certificate.public_key,
    keyEpoch
 ]
);


    // --------------------------------------------------
    // BUILD SESSION TOKEN
    // --------------------------------------------------
    const tokenPayload = JSON.stringify({
      device_id,
      firmware_hash,
      timestamp: Date.now(),
      nonce
    });

    const tokenHash =
      crypto
        .createHash('sha256')
        .update(tokenPayload)
        .digest('hex');

    const signer =
      crypto.createSign('SHA256');

    signer.update(tokenHash);
    signer.end();

    const attestation_token =
      signer.sign(
        ROOT_PRIVATE_KEY,
        'base64'
      );

    const token_expiry =
      Date.now() + (60 * 60 * 1000);

    // --------------------------------------------------
    // STORE TRUST EVENT
    // --------------------------------------------------
    await client.query(
      `
      INSERT INTO device_attestations
      (
        device_id,
        challenge,
        nonce,
        firmware_hash,
        secure_boot,
        attestation_signature,
        attestation_token,
        token_expiry,
        public_key,
        result,
        metadata,
        expires_at,
        used
      )
      VALUES
      (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,
        'VERIFIED',
        $10,
        $11,
        true
      )
      `,
      [
        device_id,
        challenge.challenge,
        nonce,
        firmware_hash,
        secure_boot,
        signature,
        attestation_token,
        token_expiry,
        device_pubkey,
        JSON.stringify({
          report_hash:
            reportHash.toString('hex')
        }),
        token_expiry
      ]
    );

    // --------------------------------------------------
    // MARK CHALLENGE USED
    // --------------------------------------------------
    await client.query(
      `
      UPDATE device_attestation_challenges
      SET used=true
      WHERE id=$1
      `,
      [challenge.id]
    );

    // --------------------------------------------------
    // AUDIT LOG
    // --------------------------------------------------
    await client.query(
      `
      INSERT INTO audit_log
      (
        action,
        target_id,
        metadata
      )
      VALUES
      (
        'DEVICE_ATTESTED',
        $1,
        $2
      )
      `,
      [
        device_id,
        JSON.stringify({
          firmware_hash,
          secure_boot
        })
      ]
    );

    await client.query('COMMIT');

    return res.json({
      ok: true,
      attested: true,
      attestation_token,
      token_expiry
    });

  } catch (err) {

    await client.query('ROLLBACK');

    try {

        // ------------------------------------------------
        // FAILED TRUST EVENT
        // ------------------------------------------------
        await client.query(
          `
          INSERT INTO device_attestations (
              device_id,
              attestation_type,
              result,
              metadata
          )
          VALUES (
              $1,
              'CHALLENGE_RESPONSE',
              'FAILED',
              $2
          )
          `,
          [
            req.body?.device_id || 'UNKNOWN',
            JSON.stringify({
              error: err.message
            })
          ]
        );

        // ------------------------------------------------
        // TRUST FAILURE STATE
        // ------------------------------------------------
        await client.query(
          `
          INSERT INTO device_trust_state (
              device_id,
              attestation_status,
              failure_count,
              last_failure_reason,
              updated_at
          )
          VALUES (
              $1,
              'FAILED',
              1,
              $2,
              NOW()
          )
          ON CONFLICT (device_id)
          DO UPDATE SET

              failure_count =
                device_trust_state.failure_count + 1,

              attestation_status = 'FAILED',

              last_failure_reason =
                EXCLUDED.last_failure_reason,

              updated_at = NOW()
          `,
          [
            req.body?.device_id || 'UNKNOWN',
            err.message
          ]
        );

    } catch (auditErr) {

        process.stdout.write(JSON.stringify({
          event: 'ATTESTATION_AUDIT_FAILURE',
          error: auditErr.message
        }) + '\n');
    }

    return res.status(400).json({
      ok: false,
      error: err.message
    });
} finally {

    client.release();

  }
};
