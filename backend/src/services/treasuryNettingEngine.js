const crypto = require('crypto');
const pool = require('../db');

function buildNettingId(pair) {

  return crypto
    .createHash('sha256')
    .update(`${pair}|${Date.now()}`)
    .digest('hex');
}

async function computeCorridorNetting(
  from_country,
  to_country
) {

  const pair =
    `${from_country}_${to_country}`;

  const result = await pool.query(
    `
    SELECT
      SUM(source_amount)
        AS gross_debit,

      SUM(destination_amount)
        AS gross_credit

    FROM treasury_liquidity_locks
    WHERE status='SETTLED'
    AND route_snapshot->>'from_country'=$1
    AND route_snapshot->>'to_country'=$2
    `,
    [
      from_country,
      to_country
    ]
  );

  const debit =
    Number(
      result.rows[0].gross_debit || 0
    );

  const credit =
    Number(
      result.rows[0].gross_credit || 0
    );

  const net =
    Math.abs(debit - credit);

  await pool.query(
    `
    INSERT INTO treasury_netting
    (
      netting_id,
      corridor_pair,
      gross_debit,
      gross_credit,
      net_amount,
      settlement_direction
    )
    VALUES ($1,$2,$3,$4,$5,$6)
    `,
    [
      buildNettingId(pair),
      pair,
      debit,
      credit,
      net,
      debit > credit
        ? 'OUTFLOW'
        : 'INFLOW'
    ]
  );

  return {
    pair,
    debit,
    credit,
    net
  };
}
// ----------------------------------------------------------
// 🛡️ THE WIRE: FINALIZE LIQUIDITY LIFECYCLE
// ----------------------------------------------------------
async function resolveNettingLifecycle({
  economic_event_id,
  success,
  client: externalClient = null
}) {
  const client = externalClient || await pool.connect();

  try {
    if (success) {
      // 🛡️ NETTING SUCCEEDS: Finalizes liquidity consumption
      await client.query(
        `UPDATE treasury_liquidity_locks
         SET status='NETTED', updated_at=NOW()
         WHERE economic_event_id=$1`,
        [economic_event_id]
      );
    } else {
      // 🛡️ SETTLEMENT FAILS: Releases reserved capital back to pool
      await client.query(
        `UPDATE treasury_liquidity_locks
         SET status='RELEASED', updated_at=NOW()
         WHERE economic_event_id=$1`,
        [economic_event_id]
      );
    }
  } finally {
    if (!externalClient) client.release();
  }
}

module.exports = {
  computeCorridorNetting,
  resolveNettingLifecycle // Export this to be called by your Workers
};