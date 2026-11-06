// =====================================================
// SETTLEMENT FINALITY WORKER (HARDENED)
// =====================================================

const { finalizeWindow } = require('../services/bankSettlementFinality');
const bankRailAdapter = require('../adapters/bankRailAdapter');
const pool = require('../db');

let interval = null;

// -----------------------------------------------------
// GLOBAL EXECUTION LOCKS
// -----------------------------------------------------
let dispatchLock = false;
let tickLock = false;

// -----------------------------------------------------
// DISPATCH TO BANK RAIL (HARDENED)
// -----------------------------------------------------
async function dispatchSettlement(record) {
  if (dispatchLock) return;
  dispatchLock = true;

  try {

    // ---------------- VALIDATION GATES ----------------
    if (!record?.global_root || !record?.certificate_hash) {
      throw new Error("INVALID_FINALITY_RECORD");
    }

    if (!record.certificate_hash || record.certificate_hash.length !== 64) {
      throw new Error("CORRUPTED_CERTIFICATE_HASH");
    }

    // ---------------- BANK CALL ----------------
    const response = await bankRailAdapter.sendTransfer({
      from: 'TRATUM_CORE',
      to: 'BANK_RAIL',
      amount: record.total_amount || record.tx_count,
      reference: record.cycle_id
    });

    const bankRef =
      response?.response?.reference ||
      response?.response?.data?.reference ||
      null;

    if (!bankRef) {
      throw new Error("BANK_NO_REFERENCE_RETURNED");
    }

    // ---------------- DB COMMIT ----------------
    await pool.query(
      `UPDATE bank_settlements
       SET status='SENT',
           bank_reference=$1,
           dispatched_at=NOW()
       WHERE cycle_id=$2`,
      [bankRef, record.cycle_id]
    );

    console.log('[FINALITY] SENT:', record.cycle_id);

  } catch (err) {

    await pool.query(
      `UPDATE bank_settlements
       SET status='RETRY'
       WHERE cycle_id=$1`,
      [record.cycle_id]
    );

    console.error('[FINALITY FAILED]', {
      cycle_id: record?.cycle_id,
      error: err.message,
      stack: err.stack
    });

  } finally {
    dispatchLock = false;
  }
}

// -----------------------------------------------------
// WORKER TICK (NO OVERLAP EXECUTION)
// -----------------------------------------------------
async function tick() {
  if (tickLock) return;
  tickLock = true;

  try {

    const record = await finalizeWindow();

    if (!record) {
      tickLock = false;
      return;
    }

    console.log('[FINALIZED]', record.cycle_id);

    await dispatchSettlement(record);

  } catch (err) {
    console.error('[FINALITY ERROR]', err.message);
  } finally {
    tickLock = false;
  }
}

// -----------------------------------------------------
// START WORKER
// -----------------------------------------------------
function start() {

  if (interval) return;

  interval = setInterval(tick, 20000);

  console.log('[SETTLEMENT FINALITY WORKER] ACTIVE');
}

module.exports = { start };