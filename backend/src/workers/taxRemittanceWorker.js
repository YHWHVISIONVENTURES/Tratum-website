const { monitoredInterval } = require('../services/monitoredInterval');
// ==========================================================
// FILE: /workers/taxRemittanceWorker.js
// TRATUM — TAX REMITTANCE WORKER
// ==========================================================

const crypto = require('crypto');
const pool = require('../db');

let interval = null;
let lock = false;

// ----------------------------------------------------------
// HELPERS
// ----------------------------------------------------------
function buildBatchId() {

  return crypto
    .randomBytes(12)
    .toString('hex');
}

// ----------------------------------------------------------
// CORE ENGINE
// ----------------------------------------------------------
async function runRemittance() {

  const client =
    await pool.connect();

  try {

    await client.query('BEGIN');

    // ------------------------------------------------------
    // FETCH ACCRUED TAXES
    // ------------------------------------------------------
    const taxes =
      await client.query(
        `
        SELECT *
        FROM tax_transactions
        WHERE tax_status='ACCRUED'
        ORDER BY created_at ASC
        LIMIT 500
        FOR UPDATE SKIP LOCKED
        `
      );

    if (!taxes.rows.length) {

      await client.query('ROLLBACK');

      return {
        status: 'NO_WORK'
      };
    }

    // ------------------------------------------------------
    // GROUP BY TAX TYPE
    // ------------------------------------------------------
    const grouped = {};

    for (const row of taxes.rows) {

      if (!grouped[row.tax_type]) {
        grouped[row.tax_type] = [];
      }

      grouped[row.tax_type]
        .push(row);
    }

    const remitted = [];

    // ------------------------------------------------------
    // PROCESS EACH TAX CLASS
    // ------------------------------------------------------
    for (const taxType of Object.keys(grouped)) {

      const batchId =
        buildBatchId();

      const rows =
        grouped[taxType];
      const ids = rows.map(r => r.id);

      const total =
        rows.reduce(
          (a, b) =>
            a + parseFloat(b.tax_amount),
          0
        );

       // =====================================================
      // 🛡️ TREASURY ESCROW: LOCK TAX FUNDS (INJECT HERE)
      // =====================================================
      // This "bags" the tax money so it cannot be used for 
      // other liquidity needs while we wait for bank confirmation.
      await lockFunds({
        account_code: 'MAIN_RESERVE_NGN',
        currency_code: 'NGN',
        amount: total,
        reference: batchId,
        source_type: 'TAX_REMITTANCE', // 👈 THE WIRE
        lock_reason: `Accrued ${taxType} Remittance Batch`,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24-hour expiry
        client: client 
      });

      // =====================================================
      // 💸 2. SOVEREIGN PAYOUT QUEUE (INJECT HERE)
      // =====================================================
      await queuePayout({
        actor_id: 'SOVEREIGN_NG', // Matches your wiring requirement
        actor_type: 'SOVEREIGN',
        payout_type: 'TAX_REMITTANCE',
        source_type: 'TAX_ENGINE',
        source_reference: batchId,
        economic_event_id: batchId, // Using batchId as anchor
        currency_code: 'NGN',
        amount: total,
        metadata: { jurisdiction: 'NG', tax_type: taxType },
        client: client // 🛡️ ATOMIC
      });
      
      // =====================================================
      // 💸 2. SOVEREIGN PAYOUT QUEUE (INJECT HERE)
      // =====================================================
      await queuePayout({
        actor_id: 'SOVEREIGN_NG', // Matches your wiring requirement
        actor_type: 'SOVEREIGN',
        payout_type: 'TAX_REMITTANCE',
        source_type: 'TAX_ENGINE',
        source_reference: batchId,
        economic_event_id: batchId, // Using batchId as anchor
        currency_code: 'NGN',
        amount: total,
        metadata: { jurisdiction: 'NG', tax_type: taxType },
        client: client // 🛡️ ATOMIC
      });

      // 2. MARK TAXES REMITTED (Existing Code)


      // ----------------------------------------------------
      // CREATE REMITTANCE BATCH
      // ----------------------------------------------------
      await client.query(
        `
        INSERT INTO tax_remittance_batches
        (
          batch_id,
          tax_type,
          total_amount,
          tx_count,
          status,
          metadata
        )
        VALUES
        (
          $1,$2,$3,$4,
          'REMITTED',
          $5
        )
        `,
        [
          batchId,
          taxType,
          total,
          rows.length,
          JSON.stringify({
            generated_by:
              'taxRemittanceWorker'
          })
        ]
      );

      // ----------------------------------------------------
      // MARK TAXES REMITTED
      // ----------------------------------------------------
await client.query(
        `
        UPDATE tax_transactions
        SET
          tax_status='REMITTED',
          remitted_at=NOW()
        WHERE id = ANY($1::bigint[])
        `,
        [ids]
      );

      // ----------------------------------------------------
      // AUDIT
      // ----------------------------------------------------
      await client.query(
        `
        INSERT INTO audit_log
        (
          actor,
          action,
          payload
        )
        VALUES
        (
          'SYSTEM',
          'TAX_REMITTED',
          $1
        )
        `,
        [
          JSON.stringify({
            batch_id: batchId,
            tax_type: taxType,
            total_amount: total,
            tx_count: rows.length
          })
        ]
      );

      remitted.push({
        batch_id: batchId,
        tax_type: taxType,
        total
      });
    }

    await client.query('COMMIT');

    return {
      status: 'SUCCESS',
      remitted
    };

  } catch (err) {

    await client.query('ROLLBACK');

    throw err;

  } finally {

    client.release();
  }
}

// ----------------------------------------------------------
// WORKER LOOP
// ----------------------------------------------------------
async function tick() {

  if (lock) return;

  lock = true;

  try {

    const result =
      await runRemittance();

    if (
      result &&
      result.remitted
    ) {

      console.log(
        `[TAX] Remitted ${result.remitted.length} batches`
      );
    }

  } catch (err) {

    console.error(
      '[TAX REMITTANCE ERROR]',
      err.message
    );

  } finally {

    lock = false;
  }
}

// ----------------------------------------------------------
// START
// ----------------------------------------------------------
function start() {

  if (interval) return;

  interval = monitoredInterval('taxRemittanceWorker', 
    tick,
    60 * 1000
  );

  console.log(
    '[TAX REMITTANCE WORKER] ACTIVE'
  );
}

module.exports = {
  start
};



