// ==========================================================
// FILE: /workers/deferredSettlementWorker.js
// ==========================================================

const pool = require('../db');

const {
  buildSettlementPlan,
  createSettlementFinality
} = require('../services/multiCurrencySettlementEngine');

const {
  processInstitutionTransaction
} = require('../services/bankSettlementEngine');

const {
  postTreasuryEntry
} = require('../services/treasuryEngine');

const {
  resolveTreasuryPool
} = require('../services/treasuryRoutingEngine');

const { releaseFunds } = require('../services/treasuryLocksEngine');

// ----------------------------------------------------------
// WORKER
// ----------------------------------------------------------
async function processDeferredSettlements() {

    await cleanupStaleLocks();



  const pending =
    await pool.query(
      `
      SELECT *
      FROM deferred_settlement_queue
      WHERE status='PENDING'
      ORDER BY created_at ASC
      LIMIT 100
      `
    );

  let processed = 0;

  for (const row of pending.rows) {

    const client =
      await pool.connect();

    try {

      await client.query('BEGIN');

      // ----------------------------------------------------
      // BUILD PLAN
      // ----------------------------------------------------
      const plan =
        await buildSettlementPlan({

          from_country:
            row.from_country,

          to_country:
            row.to_country,

          from_currency:
            row.from_currency,

          to_currency:
            row.to_currency,

          amount:
            row.amount
        });

      // ----------------------------------------------------
      // FINALITY TRACKER
      // ----------------------------------------------------
      const finalityReference =
        await createSettlementFinality({

          route: plan.route,

          operation:
            'DEFERRED_SETTLEMENT',

          source_reference:
            row.reference
        });

      // ----------------------------------------------------
      // TREASURY ROUTING
      // ----------------------------------------------------
      const treasuryPool =
        await resolveTreasuryPool({

          country:
            row.to_country,

          currency_code:
            row.to_currency

        });

      if (!treasuryPool) {
        throw new Error(
          'TREASURY_POOL_NOT_FOUND'
        );
      }

      // ----------------------------------------------------
      // TREASURY LIQUIDITY CHECK
      // ----------------------------------------------------
      const liquidity =
        await client.query(
          `
          SELECT
            COALESCE(
              SUM(
                CASE
                  WHEN direction='CREDIT'
                  THEN amount
                  ELSE -amount
                END
              ),
              0
            )::numeric(30,8) AS balance
          FROM treasury_ledger
          WHERE account_code=$1
          AND currency_code=$2
          `,
          [
            treasuryPool.account_code,
            row.to_currency
          ]
        );

      const available =
        Number(
          liquidity.rows[0]?.balance || 0
        );

      if (
        available <
        Number(plan.settlement_amount)
      ) {

        throw new Error(
          'INSUFFICIENT_TREASURY_LIQUIDITY'
        );
      }
    
      // ----------------------------------------------------
      // EXECUTE RAIL
      // ----------------------------------------------------
      const result =
        await processInstitutionTransaction(
          {
            id: row.institution_id
          },
          {
            tx_hash:
              finalityReference,

            senderID:
              row.sender_id,

            receiverID:
              row.receiver_id,

            amount:
              plan.settlement_amount,

            currency:
              row.to_currency
          }
        );

      if (
        !result ||
        result.status !==
          'TRANSFER_SENT'
      ) {
        throw new Error(
          'SETTLEMENT_FAILED'
        );
      }

            // ----------------------------------------------------
      // TREASURY DEBIT
      // ----------------------------------------------------
      await postTreasuryEntry({

        account_code:
          treasuryPool.account_code,

        direction: 'DEBIT',

        amount:
          plan.settlement_amount,

        currency_code:
          row.to_currency,

        reference:
          finalityReference,

        source_type:
          'CROSS_BORDER_SETTLEMENT',

        economic_event_id:
          finalityReference,

        metadata: {

          route:
            plan.route,

          from_country:
            row.from_country,

          to_country:
            row.to_country,

          sender:
            row.sender_id,

          receiver:
            row.receiver_id
        },

        client
      });

      // ----------------------------------------------------
      // COMPLETE
      // ----------------------------------------------------
      await client.query(
        `
        UPDATE deferred_settlement_queue
        SET
          status='COMPLETED',
          processed_at=NOW(),
          settlement_reference=$2
        WHERE id=$1
        `,
        [
          row.id,
          finalityReference
        ]
      );

      await client.query('COMMIT');

      processed++;

    } catch (err) {

      await client.query('ROLLBACK');

      await client.query(
        `
        UPDATE deferred_settlement_queue
        SET
          status='FAILED',
          error_message=$2,
          updated_at=NOW()
        WHERE id=$1
        `,
        [
          row.id,
          err.message
        ]
      );

    } finally {

      client.release();
    }
  }

  return {
    processed
  };
}

async function cleanupStaleLocks() {
  // 🛡️ REAPER: Identify bags left in the hallway for too long
  const stale = await pool.query(
    `SELECT lock_id FROM treasury_locks 
     WHERE status='LOCKED' 
     AND expires_at < NOW()`, 
    []
  );

  for (const row of stale.rows) {
    console.log(`[TREASURY_REAPER] Releasing stale lock: ${row.lock_id}`);
    await releaseFunds(row.lock_id); // 👈 Put coins back in the vault
  }
}

module.exports = {
  processDeferredSettlements,
  cleanupStaleLocks
};
