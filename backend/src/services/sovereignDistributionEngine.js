// ==========================================================
// FILE: /services/sovereignDistributionEngine.js
// TRATUM — SOVEREIGN DISTRIBUTION ENGINE
// ==========================================================

const crypto = require('crypto');

const pool = require('../db');

const {
  queuePayout
} = require('./payoutEngine');

const {
  reserveLiquidity
} = require('./treasuryLocksEngine');

const {
  registerFinality
} = require('./routeFinalityEngine');

const {
  resolveTreasuryPool
} = require('./countryResolutionEngine');

// ----------------------------------------------------------
// HELPERS
// ----------------------------------------------------------
function buildProgramReference() {

  return crypto
    .randomBytes(16)
    .toString('hex');
}

function money(v) {

  const n = Number(v);

  if (!Number.isFinite(n)) {
    throw new Error('INVALID_AMOUNT');
  }

  return n;
}

// ----------------------------------------------------------
// DISTRIBUTE PROGRAM
// ----------------------------------------------------------
async function distributeProgram({

  sovereign_id,

  country_code,

  currency_code,

  beneficiaries = [],

  economic_event_id,

  program_name,

  metadata = {},

  client: externalClient = null

}) {

  if (!sovereign_id) {
    throw new Error('INVALID_SOVEREIGN');
  }

  if (!country_code) {
    throw new Error('INVALID_COUNTRY');
  }

  if (!currency_code) {
    throw new Error('INVALID_CURRENCY');
  }

  if (!economic_event_id) {
    throw new Error('INVALID_EVENT');
  }

  if (!Array.isArray(beneficiaries)) {
    throw new Error('INVALID_BENEFICIARIES');
  }

  const client =
    externalClient ||
    await pool.connect();

  let ownsTx = false;

  try {

    if (!externalClient) {

      await client.query('BEGIN');
      ownsTx = true;
    }

    // ======================================================
    // TREASURY POOL
    // ======================================================
    const treasuryPool =
      await resolveTreasuryPool({

        country_code,

        currency_code,

        client
      });

    if (!treasuryPool) {
      throw new Error(
        'TREASURY_POOL_NOT_FOUND'
      );
    }

    const program_batch_id =
      buildProgramReference();

    let totalDistributed = 0;

    // ======================================================
    // BENEFICIARY LOOP
    // ======================================================
    for (const beneficiary of beneficiaries) {

      const beneficiary_id =
        beneficiary.beneficiary_id;

      const beneficiary_amount =
        money(beneficiary.amount);

      if (
        !beneficiary_id ||
        beneficiary_amount <= 0
      ) {
        continue;
      }

      // ====================================================
      // RESERVE LIQUIDITY
      // ====================================================
      await reserveLiquidity({

        route_id:
          program_batch_id,

        source_currency:
          currency_code,

        destination_currency:
          currency_code,

        source_amount:
          beneficiary_amount,

        destination_amount:
          beneficiary_amount,

        economic_event_id,

        reference:
          `${program_batch_id}_${beneficiary_id}`,

        client
      });

      // ====================================================
      // DISTRIBUTION LEDGER
      // ====================================================
      await client.query(
        `
        INSERT INTO sovereign_distributions
        (
          sovereign_id,
          beneficiary_id,
          batch_id,
          program_name,
          currency_code,
          amount,
          economic_event_id,
          metadata
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,$7,$8
        )
        `,
        [
          sovereign_id,
          beneficiary_id,
          program_batch_id,
          program_name || null,
          currency_code,
          beneficiary_amount,
          economic_event_id,
          JSON.stringify(metadata)
        ]
      );

      // ====================================================
      // ROUTE FINALITY
      // ====================================================
      await registerFinality({

        reference:
          `${program_batch_id}_${beneficiary_id}`,

        rail_type:
          'CBDC',

        operation:
          'SOVEREIGN_DISTRIBUTION',

        route: {

          sovereign_id,
          country_code,
          currency_code
        },

        required_confirmations: 1,

        source_reference:
          program_batch_id,

        metadata: {

          beneficiary_id,

          economic_event_id
        }
      });

      // ====================================================
      // QUEUE PAYOUT
      // ====================================================
      await queuePayout({

        actor_id:
          beneficiary_id,

        actor_type:
          'SOVEREIGN_BENEFICIARY',

        payout_type:
          'SOVEREIGN_PROGRAM',

        source_type:
          'CBDC_PROGRAM',

        source_reference:
          program_batch_id,

        economic_event_id,

        currency_code,

        amount:
          beneficiary_amount,

        client
      });

      totalDistributed +=
        beneficiary_amount;
    }

    // ======================================================
    // PROGRAM AUDIT
    // ======================================================
    await client.query(
      `
      INSERT INTO sovereign_program_events
      (
        sovereign_id,
        batch_id,
        event_type,
        total_amount,
        currency_code,
        economic_event_id,
        metadata
      )
      VALUES
      (
        $1,$2,
        'PROGRAM_DISTRIBUTED',
        $3,$4,$5,$6
      )
      `,
      [
        sovereign_id,
        program_batch_id,
        totalDistributed,
        currency_code,
        economic_event_id,
        JSON.stringify({
          beneficiaries:
            beneficiaries.length,

          program_name
        })
      ]
    );

    if (ownsTx) {
      await client.query('COMMIT');
    }

    return {

      ok: true,

      batch_id:
        program_batch_id,

      total_distributed:
        totalDistributed,

      beneficiaries:
        beneficiaries.length
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

module.exports = {
  distributeProgram
};