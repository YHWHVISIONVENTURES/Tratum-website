const crypto = require('crypto');
const pool = require('../db');

// ---------------------------------------------------
// HELPERS
// ---------------------------------------------------
function buildLockId(
  reference,
  account_code
) {

  return crypto
    .createHash('sha256')
    .update(
      `${reference}|${account_code}|${Date.now()}`
    )
    .digest('hex');
}

// ---------------------------------------------------
// LOCK FUNDS
// ---------------------------------------------------
async function lockFunds({

  account_code,
  currency_code,
  amount,
  reference,
  source_type,
  source_country,
  destination_country,
  economic_event_id = null,
  institution_id = null,
  route_id = null,
  lock_reason = null,
  metadata = {},
  expires_at = null,
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

    const treasury =
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
          ) AS balance
        FROM treasury_ledger
        WHERE account_code=$1
        AND currency_code=$2
        `,
        [
          account_code,
          currency_code
        ]
      );

    const balance =
      Number(
        treasury.rows[0].balance || 0
      );

    if (balance < Number(amount)) {
      throw new Error(
        'INSUFFICIENT_TREASURY_BALANCE'
      );
    }

    const lock_id =
      buildLockId(
        reference,
        account_code
      );

    await client.query(
      `
      INSERT INTO treasury_locks
      (
        lock_id,
        account_code,
        currency_code,
        amount,
        available_balance_snapshot,
        economic_event_id,
        reference,
        source_type,
        source_country,
        destination_country,
        lock_reason,
        institution_id,
        route_id,
        metadata,
        expires_at
      )
      VALUES
      (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,
        $11,$12,$13
      )
      `,
      [
        lock_id,
        account_code,
        currency_code,
        amount,
        balance,
        economic_event_id,
        reference,
        source_type,
        source_country,
        destination_country,
        lock_reason,
        institution_id,
        route_id,
        metadata,
        expires_at
      ]
    );

    if (ownsTx) {
      await client.query('COMMIT');
    }

    return {
      status: 'LOCKED',
      lock_id
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

// ---------------------------------------------------
// RELEASE LOCK
// ---------------------------------------------------
async function releaseFunds(
  lock_id,
  client = null
) {

  const c =
    client ||
    await pool.connect();

  try {

    await c.query(
      `
      UPDATE treasury_locks
      SET status='RELEASED',
          released_at=NOW()
      WHERE lock_id=$1
      `,
      [lock_id]
    );

  } finally {

    if (!client) {
      c.release();
    }
  }
}

// ---------------------------------------------------
// SETTLE LOCK
// ---------------------------------------------------
async function settleLock(
  lock_id,
  client = null
) {

  const c =
    client ||
    await pool.connect();

  try {

    await c.query(
      `
      UPDATE treasury_locks
      SET status='SETTLED',
          settled_at=NOW()
      WHERE lock_id=$1
      `,
      [lock_id]
    );

  } finally {

    if (!client) {
      c.release();
    }
  }
}

module.exports = {
  lockFunds,
  releaseFunds,
  settleLock
};