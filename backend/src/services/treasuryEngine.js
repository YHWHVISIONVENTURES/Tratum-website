const pool = require('../db');
const crypto = require('crypto');

function buildLedgerId(reference, account, direction) {
  return crypto
    .createHash('sha256')
    .update(`${reference}|${account}|${direction}`)
    .digest('hex');
}

async function postTreasuryEntry({
  account_code,
  direction,
  amount,
  currency_code,
  reference,
  source_type,
  economic_event_id = null,
  settlement_intent_id = null,
  metadata = {},
  client: externalClient = null
}) {

  const client = externalClient || await pool.connect();
  let ownsTx = false;

  try {

    if (!externalClient) {
      ownsTx = true;
      await client.query('BEGIN');
    }

    if (!account_code) {
      throw new Error('INVALID_ACCOUNT');
    }

    if (!currency_code) {
      throw new Error('INVALID_CURRENCY');
    }

    if (!amount || Number(amount) <= 0) {
      throw new Error('INVALID_AMOUNT');
    }

    const ledger_entry_id =
      buildLedgerId(reference, account_code, direction);

    const existing = await client.query(
      `SELECT 1 FROM treasury_ledger
       WHERE ledger_entry_id=$1
       LIMIT 1`,
      [ledger_entry_id]
    );

    if (existing.rows.length) {

      if (ownsTx) {
        await client.query('ROLLBACK');
      }

      return {
        status: 'DUPLICATE'
      };
    }

    await client.query(
      `
      INSERT INTO treasury_ledger (
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
      VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10
      )
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

    const delta =
      direction === 'CREDIT'
        ? amount
        : `-${amount}`;

    const update = await client.query(
      `
      UPDATE treasury_accounts
      SET available_balance =
          available_balance + $1::numeric,
          updated_at = NOW()
      WHERE account_code = $2
      RETURNING id
      `,
      [delta, account_code]
    );

    if (!update.rowCount) {
      throw new Error('TREASURY_ACCOUNT_NOT_FOUND');
    }

    if (ownsTx) {
      await client.query('COMMIT');
    }

    return {
      status: 'POSTED',
      ledger_entry_id
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
  postTreasuryEntry
};