// =====================================================
// FILE: /services/payoutEngine.js
// =====================================================

const crypto = require('crypto');

const pool = require('../db');

const {
  resolveCountryContext
} = require('./countryResolutionEngine');

const {
  resolveRoute
} = require('./routingEngine');

const {
  registerFinality
} = require('./routeFinalityEngine');

const {
  reserveTreasuryLiquidity, // This is your 'lock' function
  releaseFunds,             // REPLACED: Matches your engine
  settleLock                // ADDED: Matches your engine
} = require('./treasuryLocksEngine');


const {
  getRailAdapter
} = require('./railAdapterRegistry');

// =====================================================
// HELPERS
// =====================================================

function buildPayoutId(
  actor_id,
  source_reference
) {

  return crypto
    .createHash('sha256')
    .update(
      `${actor_id}|${source_reference}|PAYOUT`
    )
    .digest('hex');
}

// =====================================================
// CREATE PAYOUT
// =====================================================

async function queuePayout({

  actor_id,
  actor_type,
  payout_type,

  source_type,
  source_reference,

  economic_event_id,

  currency_code,
  amount,

  metadata = {},

  client: externalClient = null

}) {

  const client =
    externalClient ||
    await pool.connect();

  let ownsTx = false;

  try {

    if (!externalClient) {
      ownsTx = true;
      await client.query('BEGIN');
    }

    const payout_id =
      buildPayoutId(
        actor_id,
        source_reference
      );

    await client.query(
      `
      INSERT INTO payout_queue
      (
        payout_id,
        actor_id,
        actor_type,
        payout_type,
        source_type,
        source_reference,
        economic_event_id,
        currency_code,
        amount,
        metadata
      )
      VALUES
      (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10
      )
      ON CONFLICT (payout_id)
      DO NOTHING
      `,
      [
        payout_id,
        actor_id,
        actor_type,
        payout_type,
        source_type,
        source_reference,
        economic_event_id,
        currency_code,
        amount,
        JSON.stringify(metadata)
      ]
    );

    if (ownsTx) {
      await client.query('COMMIT');
    }

    return {
      payout_id,
      status: 'QUEUED'
    };

  } catch (err) {

    if (ownsTx) {
      await client.query('ROLLBACK');
    }

    throw err;

  } finally {

    if (!externalClient) {
      client.release();
    }
  }
}

// =====================================================
// EXECUTE PAYOUTS
// =====================================================

async function executePayouts() {

  const client = await pool.connect();

  try {

    const pending = await client.query(
      `
      SELECT *
      FROM payout_queue
      WHERE payout_status='PENDING'
      ORDER BY created_at ASC
      LIMIT 100
      FOR UPDATE SKIP LOCKED
      `
    );

    for (const row of pending.rows) {
        let lock = null;
      try {

        await client.query('BEGIN');



        // =========================================
        // LOAD ACCOUNT
        // =========================================
        const account =
          await client.query(
            `
            SELECT *
            FROM payout_accounts
            WHERE actor_id=$1
            AND active=true
            LIMIT 1
            `,
            [row.actor_id]
          );

        if (!account.rows.length) {
          throw new Error(
            'PAYOUT_ACCOUNT_NOT_FOUND'
          );
        }

        const payoutAccount =
          account.rows[0];

        // =========================================
        // COUNTRY CONTEXT
        // =========================================
        const country =
          await resolveCountryContext({
            country_code:
              payoutAccount.country_code
          });

        // =========================================
        // ROUTE
        // =========================================
        const route =
          await resolveRoute({

            from_country:
              'SYSTEM',

            to_country:
              payoutAccount.country_code,

            asset:
              row.currency_code
          });

        // =========================================
        // TREASURY LOCK
        // =========================================
        const lock =
          await reserveTreasuryLiquidity({

            currency_code:
              row.currency_code,

            amount:
              row.amount,

            economic_event_id:
              row.economic_event_id,

            route_id:
              route.rail,

            client
          });

        // =========================================
        // FINALITY TRACKER
        // =========================================
        await registerFinality({

          reference:
            row.payout_id,

          rail_type:
            route.rail,

          operation:
            'PAYOUT',

          route,

          source_reference:
            row.source_reference,

          metadata: {
            economic_event_id:
              row.economic_event_id
          }
        });

        // =========================================
        // RAIL ADAPTER
        // =========================================
        const adapter =
          getRailAdapter(
            route.rail,
            country
          );

        const result =
          await adapter.sendTransfer({

            from:
              'TREASURY',

            to:
              payoutAccount.payout_address,

            amount:
              row.amount,

            reference:
              row.payout_id
          });

          await settleTreasuryLock(lock.lock_id, client);

        // =========================================
        // UPDATE PAYOUT
        // =========================================
        await client.query(
          `
          UPDATE payout_queue
          SET
            payout_status='PROCESSING',
            payout_rail=$1,
            payout_reference=$2,
            processed_at=NOW(),
            route_payload=$3
          WHERE payout_id=$4
          `,
          [
            route.rail,
            result.reference,
            JSON.stringify(route),
            row.payout_id
          ]
        );

        // =========================================
        // EXECUTION LOG
        // =========================================
        await client.query(
          `
          INSERT INTO payout_execution_log
          (
            payout_id,
            execution_status,
            rail_used,
            response_payload
          )
          VALUES ($1,$2,$3,$4)
          `,
          [
            row.payout_id,
            'TRANSFER_SENT',
            route.rail,
            JSON.stringify(result)
          ]
        );

        await client.query('COMMIT');

      } catch (err) {

        await client.query('ROLLBACK');

        if (lock?.lock_id) {
    await releaseTreasuryLock(lock.lock_id);
  }

        await client.query(
          `
          UPDATE payout_queue
          SET payout_status='FAILED'
          WHERE payout_id=$1
          `,
          [row.payout_id]
        );

        await client.query(
          `
          INSERT INTO payout_execution_log
          (
            payout_id,
            execution_status,
            response_payload
          )
          VALUES ($1,$2,$3)
          `,
          [
            row.payout_id,
            'FAILED',
            JSON.stringify({
              error: err.message
            })
          ]
        );
      }
    }

  } finally {

    client.release();
  }
}

module.exports = {
  queuePayout,
  executePayouts
};