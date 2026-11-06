const pool = require('../db');
const { registerFinality, confirm } = require('../services/routeFinalityEngine');
const { recordRevenue } = require('../services/revenueLedger'); // 1. IMPORT REVENUE LEDGER

let interval = null;
let workerLock = false;

// -----------------------------------
// FETCH PENDING ITEMS
// -----------------------------------
async function fetchPending() {
  return pool.query(
    `SELECT * FROM interbank_settlements WHERE status='PENDING' ORDER BY id ASC LIMIT 20`
  );
}

// -----------------------------------
// VALIDATION & GEOGRAPHICAL FENCING
// -----------------------------------
function validateRow(row) {
  if (!row.from_bank || !row.to_bank) throw new Error('MISSING_BANK_PARTIES');
  if (row.from_bank === row.to_bank) throw new Error('SAME_BANK_INVALID');
  if (Number(row.amount) <= 0) throw new Error('INVALID_AMOUNT');
  return true;
}

function verifyGeographicFence(row) {
  if (row.required_zone && row.actual_gps_zone !== row.required_zone) {
    throw new Error('GEO_FENCE_VIOLATION: DEVICE_OUT_OF_BOUNDS');
  }
  const drift = Math.abs(Date.now() - Number(row.gps_timestamp || 0));
  if (drift > 30000) {
    throw new Error('TEMPORAL_FRAUD_DETECTED: GPS_TIME_DESYNC');
  }
}

// -----------------------------------
// UPDATE STATUS HELPER
// -----------------------------------
async function setStatus(id, status, err = null) {
  await pool.query(
    `UPDATE interbank_settlements SET status=$2, error_message=$3 WHERE id=$1`,
    [id, status, err]
  );
}

// -----------------------------------
// FINALIZE ONE ITEM (HARDENED)
// -----------------------------------
async function finalize(row) {
  await setStatus(row.id, 'VALIDATING');
  validateRow(row);
  
  await setStatus(row.id, 'GEO_VERIFYING');
  verifyGeographicFence(row); 

  // 2. FEE CALCULATION
  const { bundle } = require('../services/feeEngine'); 
  const fees = await bundle(['RAIL_SETTLEMENT', 'ROUTING_FEE'], row.amount);
  const totalDeduction = Number(row.amount) + fees.total_fee;

  await setStatus(row.id, 'NETTING');
  const liquid = await hasLiquidity(row, totalDeduction);
  if (!liquid) throw new Error('INSUFFICIENT_LIQUIDITY_FOR_SETTLEMENT_AND_FEES');

  await setStatus(row.id, 'FINALIZING');

  // 3. SETTLE & RECORD AUDIT
  await pool.query(
    `UPDATE interbank_settlements
     SET status='SETTLED', fee_deducted=$2, settled_at=NOW()
     WHERE id=$1`,
    [row.id, fees.total_fee]
  );
  
  // 4. REPLACE SYSTEM_TREASURY WITH REVENUE_LEDGER (WATERFALL SPLIT)
  await recordRevenue({
    source_type: 'INTERBANK_RAIL',
    source_ref: row.settlement_id,
    fee_type: 'RAIL_SETTLEMENT_FEES',
    amount: fees.total_fee,
    currency_code: row.currency_code,
    metadata: { 
      from_bank: row.from_bank, 
      to_bank: row.to_bank,
      fee_breakdown: fees 
    }
  });

  // 5. REGISTER & CONFIRM FINALITY
  await registerFinality({
    reference: row.settlement_id,
    rail_type: 'INTERBANK',
    operation: 'SETTLEMENT',
    route: { from_bank: row.from_bank, to_bank: row.to_bank },
    required_confirmations: 2
  });

  await confirm(row.settlement_id, 2);

  console.log(`[INTERBANK SETTLED] ${row.settlement_id} | Fee: ${fees.total_fee}`);
}

async function hasLiquidity(row) { return true; } // Placeholder

// -----------------------------------
// WORKER LOOP & START
// -----------------------------------
async function tick() {
  if (workerLock) return;
  workerLock = true;
  try {
    const result = await fetchPending();
    for (const row of result.rows) {
      try {
        await finalize(row);
      } catch (err) {
        await setStatus(row.id, 'FAILED', err.message);
        console.log(`[INTERBANK FAILED] ${row.settlement_id}:`, err.message);
      }
    }
  } catch (err) {
    console.log('[INTERBANK WORKER ERROR]', err.message);
  } finally {
    workerLock = false;
  }
}

function start() {
  if (interval) return;
  interval = setInterval(tick, 15000);
  console.log('[INTERBANK WORKER] ACTIVE');
}

module.exports = { start };
