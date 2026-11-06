const pool = require('../db');
const axios = require('axios');

// -------------------------------------
// LIVE FX FETCH (PRIMARY SOURCE)
// -------------------------------------
async function fetchLiveRate(from, to) {

  // Example external oracle (replace with real provider later)
  const res = await axios.get(
    `https://api.exchangerate.host/convert?from=${from}&to=${to}`
  );

  return {
    rate: res.data.result,
    source: 'EXTERNAL_ORACLE'
  };
}

// -------------------------------------
// CACHE READ
// -------------------------------------
async function getCachedRate(from, to) {

  const result = await pool.query(
    `SELECT rate, expires_at
     FROM fx_oracle_cache
     WHERE base_currency=$1
     AND quote_currency=$2
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [from, to]
  );

  if (!result.rows.length) return null;

  const row = result.rows[0];

  if (new Date(row.expires_at) < new Date()) {
    return null;
  }

  return Number(row.rate);
}

// -------------------------------------
// WRITE CACHE
// -------------------------------------
async function cacheRate(from, to, rate, source) {

  const expires = new Date(Date.now() + 60 * 1000); // 1 min TTL

  await pool.query(
    `INSERT INTO fx_oracle_cache
     (base_currency, quote_currency, rate, source, expires_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (base_currency, quote_currency, source)
     DO UPDATE SET
       rate=$3,
       fetched_at=NOW(),
       expires_at=$5`,
    [from, to, rate, source, expires]
  );
}

// -------------------------------------
// RESOLVE FX (REAL ENGINE)
// -------------------------------------
async function resolveRate(from, to) {

  if (from === to) return 1;

  // 1. Try cache first
  const cached = await getCachedRate(from, to);
  if (cached) return cached;

  // 2. Fetch live
  const live = await fetchLiveRate(from, to);

  await cacheRate(
    from,
    to,
    live.rate,
    live.source
  );

// ADD CIRCUIT BREAKER:

if (
  !live.rate ||
  Number(live.rate) <= 0
) {
  throw new Error(
    'INVALID_FX_RATE'
  );
}

  return live.rate;
}

module.exports = {
  resolveRate
};