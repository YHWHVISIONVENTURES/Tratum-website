const crypto = require('crypto');
const pool = require('../db');

function buildSnapshotId() {

  return crypto
    .randomBytes(16)
    .toString('hex');
}

async function snapshotTreasuryBalances() {

  const result = await pool.query(
    `
    SELECT
      account_code,
      currency_code,

      SUM(
        CASE
          WHEN direction='CREDIT'
          THEN amount
          ELSE -amount
        END
      ) AS balance

    FROM treasury_ledger
    GROUP BY
      account_code,
      currency_code
    `
  );

  for (const row of result.rows) {

    const locked =
      await pool.query(
        `
        SELECT
          COALESCE(
            SUM(amount),
            0
          ) AS locked
        FROM treasury_locks
        WHERE account_code=$1
        AND currency_code=$2
        AND status='LOCKED'
        `,
        [
          row.account_code,
          row.currency_code
        ]
      );

    const lockValue =
      Number(
        locked.rows[0].locked || 0
      );

    const balance =
      Number(row.balance || 0);

    await pool.query(
      `
      INSERT INTO treasury_balance_snapshots
      (
        snapshot_id,
        account_code,
        currency_code,
        balance,
        locked_balance,
        available_balance
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [
        buildSnapshotId(),
        row.account_code,
        row.currency_code,
        balance,
        lockValue,
        balance - lockValue
      ]
    );
  }
}

module.exports = {
  snapshotTreasuryBalances
};