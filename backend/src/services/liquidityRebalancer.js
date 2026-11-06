// ==========================================================
// FILE: /services/liquidityRebalancer.js
// TRATUM — TREASURY LIQUIDITY REBALANCER
// ==========================================================

const crypto = require('crypto');
const pool = require('../db');
const { postTreasuryEntry } = require('./treasuryEngine');

const {
  resolveTreasuryPool
} = require('./countryResolutionEngine');

// ----------------------------------------------------------
// HELPERS (RE-ADDED)
// ----------------------------------------------------------
function buildRebalanceId(fromPool, toPool, currency) {
  return crypto
    .createHash('sha256')
    .update(`${fromPool}|${toPool}|${currency}|${Date.now()}`)
    .digest('hex');
}

// ----------------------------------------------------------
// LOAD TREASURY POSITION (Hardened to show NET available)
// ----------------------------------------------------------
async function getPoolBalance(account_code, currency_code, client) {
  // 1. Get Gross Ledger Balance
  const result = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END), 0)::numeric(30,8) AS balance
     FROM treasury_ledger WHERE account_code=$1 AND currency_code=$2`,
    [account_code, currency_code]
  );

  // 2. 🛡️ WIRE: FETCH LOCKED VOLUME
  const locks = await client.query(
    `SELECT COALESCE(SUM(source_amount), 0)::numeric(30,8) AS locked_amount
     FROM treasury_liquidity_locks 
     WHERE source_currency=$1 AND status='LOCKED'`,
    [currency_code]
  );

  const gross = Number(result.rows[0].balance);
  const locked = Number(locks.rows[0].locked_amount);

  // Return Net Available (Institutional Rule)
  return gross - locked;
}

// ----------------------------------------------------------
// EXECUTE REBALANCE
// ----------------------------------------------------------
async function rebalancePool({
  from_account,
  to_account,
  currency_code,
  amount,
  currency_code,
  reason = 'AUTO_REBALANCE',
  metadata = {},
  client: externalClient = null
}) {
  const client = externalClient || await pool.connect();
  let ownsTx = false;

  try {
    if (!externalClient) {
      await client.query('BEGIN');
      ownsTx = true;
    }

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new Error('INVALID_AMOUNT');

    const treasuryPool =
  await resolveTreasuryPool({

    country_code,
    currency_code,

    client
  });

  // Safety Check: Ensure the to_account matches our Sovereign registry
    if (treasuryPool.account_code !== to_account) {
       throw new Error('ACCOUNT_POOL_MISMATCH');
    }

    const availableFrom = await getPoolBalance(from_account, currency_code, client);
    if (availableFrom < value) throw new Error('INSUFFICIENT_LIQUIDITY_IN_RESERVE');

    // 🛡️ USING THE HELPER
    const rebalanceId = buildRebalanceId(from_account, to_account, currency_code);

    await postTreasuryEntry({
      account_code: from_account,
      direction: 'DEBIT',
      amount: value,
      currency_code,
      reference: rebalanceId,
      source_type: reason,
      economic_event_id: rebalanceId,
      metadata: { side: 'SOURCE', to_account, ...metadata },
      client
    });

    await postTreasuryEntry({
      account_code: to_account,
      direction: 'CREDIT',
      amount: value,
      currency_code,
      reference: rebalanceId,
      source_type: reason,
      economic_event_id: rebalanceId,
      metadata: { side: 'TARGET', from_account, ...metadata },
      client
    });

    await client.query(
      `INSERT INTO treasury_rebalances (rebalance_id, from_account, to_account, currency_code, amount, reason, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [rebalanceId, from_account, to_account, currency_code, value, reason, JSON.stringify(metadata)]
    );

    if (ownsTx) await client.query('COMMIT');
    return { status: 'REBALANCED', rebalance_id: rebalanceId };

  } catch (err) {
    if (ownsTx) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (!externalClient) client.release();
  }
}

// ----------------------------------------------------------
// AUTO LIQUIDITY ENFORCEMENT
// ----------------------------------------------------------
async function autoRebalance() {
  const result = await pool.query(`SELECT * FROM treasury_liquidity_policy WHERE active=true`);
  const actions = [];

  for (const row of result.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const availableLiquidity = await getPoolBalance(row.account_code, row.currency_code, client);

      if (availableLiquidity < Number(row.minimum_balance)) {
        const deficit = Number(row.target_balance) - availableLiquidity;

        const r = await rebalancePool({
          from_account: row.reserve_account,
          to_account: row.account_code,
          currency_code: row.currency_code,
          amount: deficit,
          reason: 'AUTO_LIQUIDITY_REBALANCE',
          metadata: { policy_id: row.id, net_at_time: availableLiquidity },
          client 
        });

        actions.push(r);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[REBALANCE_ERROR] Corridor ${row.account_code}:`, err.message);
    } finally {
      client.release();
    }
  }
  return { actions };
}

module.exports = { rebalancePool, autoRebalance };
