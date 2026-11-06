// ==========================================================
// FILE: /services/merchantSettlementEngine.js
// ==========================================================

const crypto = require('crypto');

const pool = require('../db');

const {
  queuePayout
} = require('./payoutEngine');

const {
  postTreasuryEntry
} = require('./treasuryEngine');

// ==========================================================
// HELPERS
// ==========================================================

function buildBatchId() {

  return crypto
    .randomBytes(16)
    .toString('hex');
}

// ==========================================================
// PROCESS MERCHANT SETTLEMENTS
// ==========================================================

async function processMerchantSettlements() {

  const client = await pool.connect();

  try {

    const pending = await client.query(
      `
      SELECT *
      FROM merchant_settlements
      WHERE settlement_currency='PENDING'
      ORDER BY created_at ASC
      LIMIT 100
      FOR UPDATE SKIP LOCKED
      `
    );

    if (!pending.rows.length) {
      return {
        status: 'NO_WORK'
      };
    }

    const batchId =
      buildBatchId();

    for (const row of pending.rows) {

      try {

        await client.query('BEGIN');

        // =====================================
        // ECONOMIC EVENT
        // =====================================

        const economic_event_id =
          crypto
            .createHash('sha256')
            .update(
              `${row.payment_ref}|MERCHANT`
            )
            .digest('hex');

        // =====================================
        // TREASURY LIABILITY
        // =====================================

        await postTreasuryEntry({

          account_code:
            'MERCHANT_SETTLEMENT_CLEARING',

          direction:
            'DEBIT',

          amount:
            row.amount,

          currency_code:
            row.asset_used,

          reference:
            row.payment_ref,

          source_type:
            'MERCHANT_SETTLEMENT',

          economic_event_id,

          client
        });

        // =====================================
        // PAYOUT QUEUE
        // =====================================

        await queuePayout({

          actor_id:
            row.merchant_id,

          actor_type:
            'MERCHANT',

          payout_type:
            'MERCHANT_SETTLEMENT',

          source_type:
            'MERCHANT_ENGINE',

          source_reference:
            batchId,

          economic_event_id,

          currency_code:
            row.asset_used,

          amount:
            row.amount,

          metadata: {

            payment_ref:
              row.payment_ref
          },

          client
        });

        // =====================================
        // MARK SETTLED
        // =====================================

        await client.query(
          `
          UPDATE merchant_settlements
          SET settlement_currency=$1
          WHERE id=$2
          `,
          [
            row.asset_used,
            row.id
          ]
        );

        await client.query('COMMIT');

      } catch (err) {

        await client.query('ROLLBACK');
      }
    }

    return {
      status: 'SETTLEMENT_COMPLETE'
    };

  } finally {

    client.release();
  }
}

module.exports = {
  processMerchantSettlements
};