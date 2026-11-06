const crypto = require('crypto');

// -------------------------------------
// CHECK LIQUIDITY
// -------------------------------------
async function checkTreasuryLiquidity({

  source_currency,
  destination_currency,

  source_amount,
  destination_amount,

  source_country,
  destination_country,

  client

}) {

  const sourcePool =
    await client.query(
      `
      SELECT *
      FROM treasury_pools
      WHERE country_code=$1
      AND currency_code=$2
      LIMIT 1
      `,
      [
        source_country,
        source_currency
      ]
    );

  const destinationPool =
    await client.query(
      `
      SELECT *
      FROM treasury_pools
      WHERE country_code=$1
      AND currency_code=$2
      LIMIT 1
      `,
      [
        destination_country,
        destination_currency
      ]
    );

  if (
    !sourcePool.rows.length ||
    !destinationPool.rows.length
  ) {

    return {
      ok: false
    };
  }

  const src =
    sourcePool.rows[0];

  const dst =
    destinationPool.rows[0];

  const srcAvail =
    Number(src.available_balance);

  const dstAvail =
    Number(dst.available_balance);

  return {

    ok:
      srcAvail >= Number(source_amount) &&
      dstAvail >= Number(destination_amount),

    source_pool: src.id,
    destination_pool: dst.id,

    health_score:
      Math.min(srcAvail, dstAvail)
  };
}

// -------------------------------------
// RESERVE LIQUIDITY
// -------------------------------------
async function reserveLiquidity({

  route_id,

  source_pool,
  destination_pool,

  source_currency,
  destination_currency,

  source_amount,
  destination_amount,

  economic_event_id,

  client

}) {

  const lock_id =
    crypto.randomUUID();

  await client.query(
    `
    INSERT INTO treasury_liquidity_locks
    (
      lock_id,
      route_id,

      source_pool,
      destination_pool,

      source_currency,
      destination_currency,

      source_amount,
      destination_amount,

      economic_event_id,

      status
    )
    VALUES
    (
      $1,$2,$3,$4,
      $5,$6,$7,$8,
      $9,
      'LOCKED'
    )
    `,
    [
      lock_id,
      route_id,

      source_pool,
      destination_pool,

      source_currency,
      destination_currency,

      source_amount,
      destination_amount,

      economic_event_id
    ]
  );

  // 2. 🛡️ TOP-HARDENED: PHYSICAL DEDUCTION
  // This ensures the vault "shrinks" immediately so no one else can spend it.
  const update = await client.query(
    `
    UPDATE treasury_pools
    SET available_balance = available_balance - $1,
        updated_at = NOW()
    WHERE id = $2 AND available_balance >= $1
    RETURNING id
    `,
    [source_amount, source_pool]
  );

  if (update.rowCount === 0) {
    throw new Error('LIQUIDITY_RACE_CONDITION_DETECTED');
  }

  return {
    lock_id
  };
}

module.exports = {
  checkTreasuryLiquidity,
  reserveLiquidity
};