const { monitoredInterval } = require('../services/monitoredInterval');
const pool = require('../db');
const { charge } = require('../services/feeEngine');

let interval = null;
let running = false;

// -------------------------------------
// CHECK IF PERIOD ALREADY BILLED
// -------------------------------------
async function alreadyBilled(feeCode, periodKey) {
  const result = await pool.query(
    `SELECT 1
     FROM billing_ledger
     WHERE fee_code = $1
       AND period_key = $2
     LIMIT 1`,
    [feeCode, periodKey]
  );

  return result.rows.length > 0;
}

// -------------------------------------
// MONTH KEY
// Example: 2026-05
// -------------------------------------
function monthKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// -------------------------------------
// BANK MONTHLY BILLING
// -------------------------------------
async function billBanks(periodKey) {

  const fee = await charge(
    'BANK_MONTHLY',
    1,
    {
      source_ref: periodKey,
      currency_code: 'NGN'
    }
  );

  await pool.query(
    `INSERT INTO billing_ledger
     (
      actor_id,
      actor_type,
      fee_code,
      amount,
      period_key,
      created_at
     )
     SELECT
       institution_id,
       'BANK',
       'BANK_MONTHLY',
       $1,
       $2,
       NOW()
     FROM institutions
     WHERE status='active'
     ON CONFLICT
     (actor_id, fee_code, period_key)
     DO NOTHING`,
    [fee, periodKey]
  );
}

// -------------------------------------
// ENTERPRISE ROYALTY BILLING
// -------------------------------------
async function billEnterprise(periodKey) {

  const fee = await charge(
    'ROYALTY_ENTERPRISE',
    1,
    {
      source_ref: periodKey,
      currency_code: 'NGN'
    }
  );

  await pool.query(
    `INSERT INTO billing_ledger
     (
      actor_id,
      actor_type,
      fee_code,
      amount,
      period_key,
      created_at
     )
     SELECT
       enterprise_id,
       'ENTERPRISE',
       'ROYALTY_ENTERPRISE',
       $1,
       $2,
       NOW()
     FROM enterprise_accounts
     WHERE active=true
     ON CONFLICT
     (actor_id, fee_code, period_key)
     DO NOTHING`,
    [fee, periodKey]
  );
}

// -------------------------------------
// MAIN RUNNER
// -------------------------------------
async function runMonthlyBilling() {

  if (running) return;
  running = true;

  try {

    const periodKey = monthKey();

    const bankDone =
      await alreadyBilled(
        'BANK_MONTHLY',
        periodKey
      );

    if (!bankDone) {
      await billBanks(periodKey);
      console.log(
        '[BILLING] BANK monthly complete:',
        periodKey
      );
    }

    const entDone =
      await alreadyBilled(
        'ROYALTY_ENTERPRISE',
        periodKey
      );

    if (!entDone) {
      await billEnterprise(periodKey);
      console.log(
        '[BILLING] ENTERPRISE royalty complete:',
        periodKey
      );
    }

  } catch (err) {

    console.error(
      '[BILLING ERROR]',
      err.message
    );

  } finally {

    running = false;

  }
}

// -------------------------------------
// START
// -------------------------------------
function start() {

  if (interval) return;

  interval = monitoredInterval('institutionBillingWorker', 
    runMonthlyBilling,
    3600000
  ); // hourly check

  runMonthlyBilling();

  console.log(
    '[BILLING WORKER] ACTIVE'
  );
}

module.exports = { start };
