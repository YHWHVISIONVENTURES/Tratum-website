// ==========================================================
// FILE: /engine/treasuryPostingEngine.js
// ==========================================================

const crypto = require('crypto');
const pool = require('../db');

function buildLedgerEntryId(ref) {

  return crypto
    .createHash('sha256')
    .update(ref)
    .digest('hex');
}

async function postTreasuryEntry({

  account_code,
  direction,
  amount,
  currency_code = 'NGN',
  reference,
  source_type,
  economic_event_id,
  settlement_intent_id = null,
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

    const ledger_entry_id =
      buildLedgerEntryId(
        `${reference}|${direction}|${account_code}`
      );

    await client.query(
      `
      INSERT INTO treasury_ledger
      (
        ledger_entry_id,
        account_code,
        direction,
        amount,
        currency_code,
        reference,
        source_type,
        economic_event_id,
        settlement_intent_id,
        metadata
      )
      VALUES
      (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10
      )
      ON CONFLICT
      (ledger_entry_id)
      DO NOTHING
      `,
      [
        ledger_entry_id,
        account_code,
        direction,
        amount,
        currency_code,
        reference,
        source_type,
        economic_event_id,
        settlement_intent_id,
        metadata
      ]
    );

    if (ownsTx) {
      await client.query('COMMIT');
    }

    return ledger_entry_id;

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
  postTreasuryEntry
};