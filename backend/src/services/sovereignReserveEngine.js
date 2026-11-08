// ==========================================================
// FILE: /services/sovereignReserveEngine.js
// ==========================================================

const pool = require('../db');

const {
  postTreasuryEntry
} = require('./treasuryEngine');

const { lockFunds } = require('./treasuryLocksEngine');

// ----------------------------------------------------------
// CREDIT RESERVE
// ----------------------------------------------------------
async function creditReserve({

  sovereign_id,

  currency_code,

  amount,

  reference,

  source_type,

  economic_event_id,

  metadata = {},

  client

}) {

  const account =
    `SOVEREIGN_RESERVE_${currency_code}`;

  await postTreasuryEntry({

    account_code: account,

    direction: 'CREDIT',

    amount,

    currency_code,

    reference,

    source_type,

    economic_event_id,

    metadata: {
      sovereign_id,
      ...metadata
    },

    client
  });
}


// ----------------------------------------------------------
// DEBIT RESERVE
// ----------------------------------------------------------
async function debitReserve({

  sovereign_id,

  currency_code,

  amount,

  reference,

  source_type,

  economic_event_id,

  metadata = {},

  client

}) {

  const account =
    `SOVEREIGN_RESERVE_${currency_code}`;

// =====================================================
  // 🛡️ SOVEREIGN LOCK: SECURE THE RESERVE (INJECT HERE)
  // =====================================================
  await lockFunds({
    account_code: account,
    currency_code,
    amount,
    reference,
    source_type: 'SOVEREIGN_RESERVE', // 👈 THE WIRE
    economic_event_id,
    lock_reason: `Sovereign Reserve Debit: ${source_type}`,
    metadata: { sovereign_id, ...metadata },
    expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48h for Sovereign moves
    client // 🛡️ ATOMIC
  });

  await postTreasuryEntry({

    account_code: account,

    direction: 'DEBIT',

    amount,

    currency_code,

    reference,

    source_type,

    economic_event_id,

    metadata: {
      sovereign_id,
      ...metadata
    },

    client
  });
}

module.exports = {
  creditReserve,
  debitReserve
};
