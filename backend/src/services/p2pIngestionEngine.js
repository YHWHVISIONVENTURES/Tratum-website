const pool = require('../db');
const crypto = require('crypto');

const { verifyTransaction } = require('../security/verificationEngine');

const { applyFees } = require('./billingEngine');
const { recordRevenue } = require('./revenueLedger');

// ---------------------------------------------
// HELPERS
// ---------------------------------------------

function normalizeTimestamp(ts) {
  const n = Number(ts);

  if (!Number.isFinite(n)) {
    throw new Error('INVALID_TIMESTAMP');
  }

  return n < 1e12 ? n * 1000 : n;
}

function assertTimestamp(ts) {
  const now = Date.now();

  // future drift protection
  if (ts > now + (5 * 60 * 1000)) {
    throw new Error('FUTURE_TIMESTAMP');
  }

  // stale replay protection
  if (ts < now - (7 * 24 * 60 * 60 * 1000)) {
    throw new Error('STALE_TRANSACTION');
  }
}

function assertHex(value, field) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-fA-F]+$/.test(value)
  ) {
    throw new Error(`INVALID_${field}_ENCODING`);
  }
}

function buildEconomicEventId(tx_hash, issuer_id) {
  return crypto
    .createHash('sha256')
    .update(`P2P|${tx_hash}|${issuer_id}`)
    .digest('hex');
}

// ---------------------------------------------
// CORE INGESTION
// ---------------------------------------------

async function ingestP2PTransaction(tx) {

  // ---------------------------------------------
  // 0. FAIL-FAST STRUCTURE VALIDATION
  // ---------------------------------------------
  if (!tx || typeof tx !== 'object') {
    throw new Error('INVALID_TX');
  }

  if (!tx.tx_hash || typeof tx.tx_hash !== 'string') {
    throw new Error('INVALID_TX_HASH');
  }

  if (!tx.senderID || !tx.receiverID) {
    throw new Error('INVALID_PARTICIPANTS');
  }

  if (!tx.issuer_id || typeof tx.issuer_id !== 'string') {
    throw new Error('INVALID_ISSUER');
  }

  if (!tx.amount || isNaN(Number(tx.amount))) {
    throw new Error('INVALID_AMOUNT');
  }

  if (Number(tx.amount) <= 0) {
    throw new Error('INVALID_AMOUNT');
  }

  if (!tx.signature) {
    throw new Error('MISSING_SIGNATURE');
  }

  if (!tx.nonce) {
    throw new Error('MISSING_NONCE');
  }

  if (!tx.prevHash) {
    throw new Error('MISSING_PREV_HASH');
  }

  if (!tx.merkleRoot) {
    throw new Error('MISSING_MERKLE_ROOT');
  }

  // ---------------------------------------------
  // DEVICE ID VALIDATION
  // ---------------------------------------------
  assertHex(tx.senderID, 'SENDER_DEVICE_ID');
  assertHex(tx.receiverID, 'RECEIVER_DEVICE_ID');

  if (
    tx.senderID.length !== 16 ||
    tx.receiverID.length !== 16
  ) {
    throw new Error('INVALID_DEVICE_ID_LENGTH');
  }

  // ---------------------------------------------
  // NORMALIZE + ASSERT TIMESTAMP
  // ---------------------------------------------
  const normalizedTs = normalizeTimestamp(tx.timestamp);

  assertTimestamp(normalizedTs);

  // ---------------------------------------------
  // ECONOMIC EVENT ID
  // ---------------------------------------------
  const economic_event_id =
    buildEconomicEventId(
      tx.tx_hash,
      tx.issuer_id
    );

  const client = await pool.connect();

  try {

    await client.query('BEGIN');

    // ---------------------------------------------
    // 1. IDEMPOTENCY CHECK
    // ---------------------------------------------
    const existingTx = await client.query(
      `
      SELECT tx_hash
      FROM transactions
      WHERE tx_hash = $1
      LIMIT 1
      `,
      [tx.tx_hash]
    );

    if (existingTx.rows.length) {

      await client.query('ROLLBACK');

      return {
        status: 'DUPLICATE',
        tx_hash: tx.tx_hash
      };
    }

    // ---------------------------------------------
    // 2. DEVICE REGISTRY VALIDATION
    // ---------------------------------------------
    const deviceState = await client.query(
      `
      SELECT
        d.device_id,
        d.public_key,
        d.last_merkle_root,
        d.status,

        r.issuer_id,
        r.status AS registry_status,
        r.certificate_hash,
        r.certificate_signature

      FROM devices d
      INNER JOIN device_registry r
        ON r.device_id = d.device_id

      WHERE d.device_id = $1
      LIMIT 1
      `,
      [tx.senderID]
    );

    if (!deviceState.rows.length) {
      throw new Error('DEVICE_NOT_REGISTERED');
    }

    const trust = await client.query(
 `
 SELECT
   attestation_status,
   token_expiry,
   trust_score
 FROM device_trust_state
 WHERE device_id=$1
 LIMIT 1
 `,
 [tx.senderID]
);

if (!trust.rows.length) {
  throw new Error('DEVICE_NOT_ATTESTED');
}

const trustState = trust.rows[0];

if (trustState.attestation_status !== 'VERIFIED') {
  throw new Error('DEVICE_UNTRUSTED');
}

if (
  Number(trustState.token_expiry) < Date.now()
) {
  throw new Error('ATTESTATION_EXPIRED');
}

if (
  Number(trustState.trust_score) <= 0
) {
  throw new Error('DEVICE_TRUST_REVOKED');
}

    const device = deviceState.rows[0];

    // ---------------------------------------------
    // DEVICE STATUS ENFORCEMENT
    // ---------------------------------------------
    if (device.status !== 'ACTIVE') {
      throw new Error('DEVICE_BLOCKED');
    }

    if (device.registry_status !== 'ACTIVE') {
      throw new Error('DEVICE_REGISTRY_BLOCKED');
    }

    // ---------------------------------------------
    // ISSUER BINDING ENFORCEMENT
    // ---------------------------------------------
    if (device.issuer_id !== tx.issuer_id) {
      throw new Error('ISSUER_DEVICE_MISMATCH');
    }

    // ---------------------------------------------
    // CERTIFICATE PRESENCE ENFORCEMENT
    // ---------------------------------------------
    if (
      !device.certificate_hash ||
      !device.certificate_signature
    ) {
      throw new Error('DEVICE_CERTIFICATE_MISSING');
    }

    // ---------------------------------------------
    // 3. CERTIFICATE STATUS VALIDATION
    // ---------------------------------------------
    const cert = await client.query(
      `
      SELECT
        status,
        expiry_at,
        revoked_at
      FROM certificate_records
      WHERE device_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [tx.senderID]
    );

    if (!cert.rows.length) {
      throw new Error('CERTIFICATE_NOT_FOUND');
    }

    const certState = cert.rows[0];

    if (certState.status !== 'ACTIVE') {
      throw new Error('CERTIFICATE_REVOKED');
    }

    if (
      certState.expiry_at &&
      Number(certState.expiry_at) < Date.now()
    ) {
      throw new Error('CERTIFICATE_EXPIRED');
    }

    // ---------------------------------------------
    // 4. INSTITUTION VALIDATION
    // ---------------------------------------------
    const institution = await client.query(
      `
      SELECT institution_id
      FROM institutions
      WHERE institution_id = $1
      LIMIT 1
      `,
      [tx.issuer_id]
    );

    if (!institution.rows.length) {
      throw new Error('UNAUTHORIZED_ISSUER');
    }

    // ---------------------------------------------
    // 5. NONCE REPLAY PROTECTION
    // ---------------------------------------------
    const nonceReplay = await client.query(
      `
      SELECT 1
      FROM transactions
      WHERE sender_id = $1
      AND nonce = $2
      LIMIT 1
      `,
      [
        tx.senderID,
        tx.nonce
      ]
    );

    if (nonceReplay.rows.length) {
      throw new Error('NONCE_REPLAY_DETECTED');
    }

    // ---------------------------------------------
    // 6. RATE LIMIT PROTECTION
    // ---------------------------------------------
    const rate = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM transactions
      WHERE issuer_id = $1
      AND created_at > NOW() - INTERVAL '10 seconds'
      `,
      [tx.issuer_id]
    );

    if (rate.rows[0].count > 300) {
      throw new Error('RATE_LIMIT_EXCEEDED');
    }

    // ---------------------------------------------
    // 7. LEDGER CONTINUITY CHECK
    // ---------------------------------------------
    if (
      device.last_merkle_root &&
      device.last_merkle_root !== tx.prevHash
    ) {
      throw new Error('LEDGER_FORK_DETECTED');
    }

    // ---------------------------------------------
    // 8. CRYPTOGRAPHIC VERIFICATION
    // ---------------------------------------------
    verifyTransaction(
      tx,
      device.public_key
    );

    // ---------------------------------------------
    // 9. INSERT TRANSACTION
    // ---------------------------------------------
    const inserted = await client.query(
      `
      INSERT INTO transactions (
        tx_hash,
        sender_id,
        receiver_id,
        amount,
        timestamp,
        nonce,
        issuer_id,
        status,
        synced,
        raw_payload,
        settlement_status,
        economic_event_id
      )
      VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,
        1,true,$8,
        'PENDING',$9
      )
      ON CONFLICT (tx_hash)
      DO NOTHING
      RETURNING tx_hash
      `,
      [
        tx.tx_hash,
        tx.senderID,
        tx.receiverID,
        tx.amount,
        normalizedTs,
        tx.nonce,
        tx.issuer_id,
        JSON.stringify(tx),
        economic_event_id
      ]
    );

    if (inserted.rowCount === 0) {

      await client.query('ROLLBACK');

      return {
        status: 'DUPLICATE',
        tx_hash: tx.tx_hash
      };
    }

    // ---------------------------------------------
    // 10. BILLING ENGINE
    // ---------------------------------------------
    const fees = await applyFees({
      actor_id: tx.issuer_id,
      actor_type: 'INSTITUTION',

      amount: tx.amount,

      fee_codes: [
        'PROTOCOL_GAS'
      ],

      source_ref: tx.tx_hash,
      source_type: 'P2P',

      currency_code:
        tx.currency || 'NGN',

      metadata: {
        sender: tx.senderID,
        receiver: tx.receiverID,
        economic_event_id
      },

      client
    });

    
    // ---------------------------------------------
    // 11. REVENUE ENGINE
    // ---------------------------------------------
    const gasFee =
      Number(fees?.PROTOCOL_GAS || 0);

    if (gasFee > 0) {

      await recordRevenue({
        source_type: 'P2P',
        source_ref: tx.tx_hash,

        fee_type: 'PROTOCOL_GAS',

        amount: gasFee,

        currency_code:
          tx.currency || 'NGN',

        metadata: {
          issuer_id: tx.issuer_id,
          sender: tx.senderID,
          receiver: tx.receiverID,
          economic_event_id
        },

        client
      });
    }

    await queueComplianceEvent({
  economic_event_id,
  event_type: 'TX_INGESTED',
  actor_id: tx.issuer_id,
  source_ref: tx.tx_hash,
  amount: tx.amount,
  currency_code: tx.currency || 'NGN',
  client
});

await client.query(`
  INSERT INTO audit_log
  (actor, action, payload)
  VALUES ($1,$2,$3)
`, [
  tx.issuer_id,
  'TX_INGESTED',
  JSON.stringify({
    tx_hash: tx.tx_hash,
    economic_event_id
  })
]);

    // ---------------------------------------------
    // 12. ECONOMIC SNAPSHOT
    // ---------------------------------------------
    await client.query(
      `
      UPDATE transactions
      SET economic_snapshot = $1
      WHERE tx_hash = $2
      `,
      [
        JSON.stringify({
          fees,
          economic_event_id,
          policy: 'v1'
        }),
        tx.tx_hash
      ]
    );

    // ---------------------------------------------
    // 13. DEVICE STATE UPDATE
    // ---------------------------------------------
    await client.query(
      `
      UPDATE devices
      SET
        last_merkle_root = $1,
        last_seen = NOW(),
        ledger_count = ledger_count + 1
      WHERE device_id = $2
      `,
      [
        tx.merkleRoot,
        tx.senderID
      ]
    );

    // ---------------------------------------------
    // 14. COMMIT
    // ---------------------------------------------
    await client.query('COMMIT');

    return {
      status: 'INGESTED',
      tx_hash: tx.tx_hash,
      economic_event_id,
      fees
    };

  } catch (err) {

    await client.query('ROLLBACK');

    await client.query(
  `
  INSERT INTO audit_log
  (actor, action, payload)
  VALUES ($1,$2,$3)
  `,
  [
    tx?.issuer_id || 'SYSTEM',
    'P2P_INGESTION_FAILED',
    JSON.stringify({
      tx_hash: tx?.tx_hash,
      error: err.message
    })
  ]
);

    process.stdout.write(
      JSON.stringify({
        event: 'P2P_INGESTION_FAILED',
        tx_hash: tx?.tx_hash,
        issuer_id: tx?.issuer_id,
        sender: tx?.senderID,
        error: err.message
      }) + '\n'
    );

    throw err;

  } finally {

    client.release();
  }
}

module.exports = {
  ingestP2PTransaction
};