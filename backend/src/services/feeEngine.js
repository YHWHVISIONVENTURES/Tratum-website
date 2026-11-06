const pool = require('../db');

// -----------------------------------
// INTERNAL: SAFE NUMERIC PARSER
// -----------------------------------
function toNumber(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

// -----------------------------------
// INTERNAL: ROUNDING (BANK SAFE)
// -----------------------------------
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// -----------------------------------
// GET POLICY (HARDENED)
// -----------------------------------
async function getPolicy(code) {

  if (!code || typeof code !== 'string') {
    throw new Error('INVALID_FEE_CODE');
  }

  const result = await pool.query(
    `SELECT fee_code, flat_amount, percent_amount, min_amount, max_amount, currency_code
     FROM fee_policies
     WHERE fee_code=$1
     AND active=true
     LIMIT 1`,
    [code]
  );

  if (!result.rows.length) {
    return null;
  }

  return result.rows[0];
}

// -----------------------------------
// CORE COMPUTE (HYBRID MODEL)
// -----------------------------------
function compute(amount, policy) {

  if (!policy) throw new Error('MISSING_POLICY');

  const value = toNumber(amount);

  if (value < 0) {
    throw new Error('INVALID_AMOUNT');
  }

  const flat = toNumber(policy.flat_amount);
  const pct  = toNumber(policy.percent_amount);

  const min  = toNumber(policy.min_amount);
  const max  = policy.max_amount != null
    ? toNumber(policy.max_amount)
    : null;

  // -----------------------------
  // BASE FEE (HYBRID)
  // -----------------------------
  let fee = flat + ((value * pct) / 100);

  // -----------------------------
  // APPLY MIN FLOOR
  // -----------------------------
  if (min && fee < min) {
    fee = min;
  }

  // -----------------------------
  // APPLY MAX CAP
  // -----------------------------
  if (max !== null && fee > max) {
    fee = max;
  }

  // -----------------------------
  // FINAL ROUNDING
  // -----------------------------
  return round2(fee);
}

// -----------------------------------
// PUBLIC: SINGLE FEE (PURE)
// -----------------------------------
async function quote(fee_code, amount = 0) {

  const policy = await getPolicy(fee_code);

  if (!policy) {
    return {
      fee_code,
      amount: 0,
      applied: false
    };
  }

  const fee = compute(amount, policy);

  return {
    fee_code,
    amount: fee,
    currency: policy.currency_code || 'NGN',
    applied: fee > 0
  };
}

// -----------------------------------
// PUBLIC: MULTI FEE (BUNDLE)
// -----------------------------------
async function quoteBundle(codes, amount = 0) {

  if (!Array.isArray(codes) || !codes.length) {
    throw new Error('INVALID_FEE_CODES');
  }

  const result = {};
  let total = 0;

  for (const code of codes) {

    const q = await quote(code, amount);

    result[code] = q.amount;
    total += q.amount;
  }

  result.total_fee = round2(total);

  return result;
}

module.exports = {
  quote,
  quoteBundle,
  compute // exposed for testing determinism
};