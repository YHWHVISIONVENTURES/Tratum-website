const pool = require('../db');
const crypto = require('crypto');
const { processInstitutionTransaction } = require('../services/bankSettlementEngine');
const { postTreasuryEntry } =
  require('../services/treasuryEngine');
  const {
  recordCorridorMetric
} = require(
  './corridorHealthEngine'
);

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function buildBatchId() {
  return crypto.randomBytes(12).toString('hex');
}

function buildSettlementId(source_ref, actor_id) {
  return crypto
    .createHash('sha256')
    .update(`SETTLEMENT|${source_ref}|${actor_id}`)
    .digest('hex');
}

function buildNonce() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

// --------------------------------------------------
// CORE SETTLEMENT BRIDGE
// --------------------------------------------------
async function runSettlementBridge() {

  const client = await pool.connect();

  try {

    // -----------------------------------------
    // 1. FETCH ELIGIBLE BILLING (NO LOCK YET)
    // -----------------------------------------
    const pending = await client.query(
      `
      SELECT *
      FROM settlement_intents
      WHERE status='PENDING'
      AND settlement_type='BILLING'
      ORDER BY created_at ASC
      LIMIT 100
      FOR UPDATE SKIP LOCKED;
        AND settlement_lock_id IS NULL
        AND created_at <= NOW() - INTERVAL '1 minute'
      ORDER BY created_at ASC
      LIMIT 100
      `
    );

    if (!pending.rows.length) {
      return { status: 'NO_WORK' };
    }

    const batchId = buildBatchId();

    // -----------------------------------------
    // 2. OPEN BATCH (AUDIT ONLY)
    // -----------------------------------------
    await client.query(
      `
      INSERT INTO settlement_batches
      (batch_id, total_amount, tx_count, status)
      VALUES ($1, 0, 0, 'OPEN')
      `,
      [batchId]
    );

    let total = 0;
    let successCount = 0;

    // -----------------------------------------
    // 3. PROCESS EACH ROW (DETERMINISTIC LOCK)
    // -----------------------------------------
    for (const row of pending.rows) {

      const settlementId = buildSettlementId(row.source_ref, row.actor_id);

      try {

        // -----------------------------------------
        // 3.1 DETERMINISTIC RESERVATION LOCK
        // -----------------------------------------
        const lockRes = await client.query(
          `
          UPDATE billing_ledger
          SET settlement_lock_id = $1
          WHERE id = $2
            AND paid = false
            AND settlement_lock_id IS NULL
          RETURNING id
          `,
          [settlementId, row.id]
        );

        if (!lockRes.rows.length) {
          continue; // already claimed elsewhere
        }

        const trust = await pool.query(
 `
 SELECT
   attestation_status,
   token_expiry
 FROM device_trust_state
 WHERE device_id=$1
 LIMIT 1
 `,
 [device_id]
);

if (!trust.rows.length) {
  throw new Error('DEVICE_NOT_ATTESTED');
}

if (
  trust.rows[0].attestation_status !== 'VERIFIED'
) {
  throw new Error('DEVICE_UNTRUSTED');
}

if (
  Number(trust.rows[0].token_expiry)
  < Date.now()
) {
  throw new Error('ATTESTATION_EXPIRED');
}

const route =
  await resolveRoute({

    source_country:
      row.metadata?.source_country,

    destination_country:
      row.metadata?.destination_country,

    source_currency:
      row.currency_code || 'NGN',

    destination_currency:
      row.metadata?.destination_currency ||
      row.currency_code,

    source_amount:
      row.amount,

    sender_id:
      row.actor_id,

    receiver_id:
      row.metadata?.receiver_id,

    economic_event_id:
      row.metadata?.economic_event_id,

    client
  });

  await registerFinality({

  reference:
    settlementId,

  rail_type:
    route.rail.rail,

  operation:
    'CROSS_BORDER_SETTLEMENT',

  route,

  required_confirmations: 1,

  source_reference:
    row.source_ref,

  metadata: {
    economic_event_id:
      row.metadata?.economic_event_id
  }
});

        // -----------------------------------------
        // 3.2 VALIDATE INSTITUTION
        // -----------------------------------------
        const inst = await client.query(
          `SELECT 1 FROM institutions WHERE institution_id=$1 LIMIT 1`,
          [row.actor_id]
        );

        if (!inst.rows.length) {
          throw new Error('INVALID_INSTITUTION');
        }

        // -----------------------------------------
        // 3.3 BUILD SETTLEMENT TX
        // -----------------------------------------
        const tx = {
          tx_hash: `SETTLE_${row.id}`,
          senderID: row.actor_id,
          receiverID: 'TREASURY',
          amount: row.amount.toString(),
          timestamp: Date.now(),
          nonce: buildNonce()
        };

        // -----------------------------------------
        // 3.4 EXECUTE BANK RAIL (EXTERNAL SIDE EFFECT)
        // -----------------------------------------
        const result = await processInstitutionTransaction(
          { id: row.actor_id },
          tx
        );

        if (!result || result.status !== 'TRANSFER_SENT') {
          throw new Error('RAIL_FAILED');
        }

        await recordCorridorMetric({
  corridor_id:
    `${row.from_country}_${row.to_country}`,

  latency_ms: 1200,

  success: true,

  volume: row.amount
});

        // -----------------------------------------
        // 3.5 FINALIZE SETTLEMENT (ATOMIC DB WRITE)
        // -----------------------------------------
        await client.query('BEGIN');

        await client.query(
          `
          UPDATE billing_ledger
          SET paid = true,
              paid_at = NOW()
          WHERE id = $1
          `,
          [row.id]
        );

// ==========================================
// CLEAR SETTLEMENT BUFFER
// ==========================================
await postTreasuryEntry({
  account_code: 'SETTLEMENT_BUFFER_NGN',
  direction: 'DEBIT',
  amount: row.amount,
  currency_code: 'NGN',
  reference: row.source_ref,
  source_type: 'BILLING_SETTLEMENT',
  economic_event_id:
    row.metadata?.economic_event_id || null,
  client
});

// ==========================================
// TREASURY RECEIVES FUNDS
// ==========================================
await postTreasuryEntry({
  account_code: 'TREASURY_NGN',
  direction: 'CREDIT',
  amount: row.amount,
  currency_code: 'NGN',
  reference: row.source_ref,
  source_type: 'BILLING_SETTLEMENT',
  economic_event_id:
    row.metadata?.economic_event_id || null,
  client
});

        await client.query(
          `
          INSERT INTO settlement_bridge (
            settlement_id,
            reference,
            institution_id,
            amount,
            status,
            processed_at,
            metadata
          )
          VALUES ($1,$2,$3,$4,'CONFIRMED',NOW(),$5)
          ON CONFLICT (settlement_id) DO NOTHING
          `,
          [
            settlementId,
            row.source_ref,
            row.actor_id,
            row.amount,
            JSON.stringify({
              batch_id: batchId,
              economic_event_id: row.metadata?.economic_event_id || null,
              settlement_id: settlementId
            })
          ]
        );

        await client.query('COMMIT');

        await client.query(
  `
  INSERT INTO audit_log
  (actor, action, payload)
  VALUES ($1,$2,$3)
  `,
  [
    row.actor_id,
    'SETTLEMENT_CONFIRMED',
    JSON.stringify({
      settlement_id: settlementId,
      amount: row.amount,
      batch_id: batchId
    })
  ]
);

        total += parseFloat(row.amount);
        successCount++;

      } catch (err) {

        await client.query('ROLLBACK');

        await recordCorridorMetric({
  corridor_id:
    `${row.from_country}_${row.to_country}`,

  latency_ms: 15000,

  success: false,

  volume: row.amount
});

        await client.query(
  `
  INSERT INTO audit_log
  (actor, action, payload)
  VALUES ($1,$2,$3)
  `,
  [
    row.actor_id,
    'SETTLEMENT_FAILED',
    JSON.stringify({
      settlement_id: settlementId,
      error: err.message
    })
  ]
);

        await client.query(
          `
          INSERT INTO settlement_bridge (
            settlement_id,
            reference,
            institution_id,
            amount,
            status,
            metadata
          )
          VALUES ($1,$2,$3,$4,'FAILED',$5)
          ON CONFLICT (settlement_id) DO NOTHING
          `,
          [
            settlementId,
            row.source_ref,
            row.actor_id,
            row.amount,
            JSON.stringify({
              error: err.message,
              batch_id: batchId
            })
          ]
        );
      }
    }

    // -----------------------------------------
    // 4. CLOSE BATCH
    // -----------------------------------------
    await client.query(
      `
      UPDATE settlement_batches
      SET total_amount = $1,
          tx_count = $2,
          status = 'CLOSED',
          closed_at = NOW()
      WHERE batch_id = $3
      `,
      [total, successCount, batchId]
    );

    return {
      batchId,
      total,
      success: successCount
    };

  } finally {
    client.release();
  }
}

module.exports = {
  runSettlementBridge
};