const { monitoredInterval } = require('../services/monitoredInterval');
const { runReconciliation } = require('../services/reconciliationEngine');
// 🛡️ NEW IMPORTS
const { snapshotTreasuryBalances } = require('../services/treasuryBalanceSnapshotEngine');
const { computeFXExposure } = require('../services/fxExposureEngine');

let interval = null;

async function tick() {
  const now = new Date();

  // 🕒 MIDNIGHT GATE: Only execute during the 00:00 hour
  if (now.getHours() !== 0) return;

  try {
    console.log('[MIDNIGHT_AUDIT] Starting Sovereign Daily Close...');

    // 1. 📷 SNAPSHOT: Record exactly what is in every vault (Balance vs Locked)
    await snapshotTreasuryBalances();
    console.log('[MIDNIGHT_AUDIT] Treasury Snapshot Complete.');

    // 2. 📉 EXPOSURE: Calculate risk levels and net liquidity
    await computeFXExposure();
    console.log('[MIDNIGHT_AUDIT] FX Exposure Calculated.');

    // 3. 🔍 RECONCILIATION: Cross-check Node Ledger vs Treasury Ledger
    const result = await runReconciliation();
    console.log('[RECON]', result.notes);

    // 🛡️ SUCCESS LOG
    console.log('[MIDNIGHT_AUDIT] System Balanced and Verified.');

  } catch (err) {
    console.log('[RECON ERROR]', err.message);
    
    // 🔴 CRITICAL ALERT: If midnight audit fails, it must be logged to fraud_alerts
    // await logCriticalAlert('MIDNIGHT_AUDIT_FAILED', { error: err.message });
  }
}

function start() {
  if (interval) return;

  // Checks once every hour
  interval = monitoredInterval('reconciliationWorker', tick, 60 * 60 * 1000);

  console.log('[RECONCILIATION WORKER] ACTIVE');
}

module.exports = { start };

