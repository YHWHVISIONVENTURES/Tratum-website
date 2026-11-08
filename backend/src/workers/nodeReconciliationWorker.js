const { monitoredInterval } = require('../services/monitoredInterval');
const pool = require('../db');

let interval = null;

// 1. THE ENGINE (The SQL Math)
async function runReconciliation() {
  try {
    const mismatch = await pool.query(`
      SELECT
        (SUM(CASE WHEN entry_type='MINT' THEN amount ELSE 0 END) -
         SUM(CASE WHEN entry_type='BURN' THEN amount ELSE 0 END)) AS net_nodes,
        ((SELECT COALESCE(SUM(amount),0) FROM treasury_movements WHERE direction='IN') -
         (SELECT COALESCE(SUM(amount),0) FROM treasury_movements WHERE direction='OUT')) AS net_treasury
      FROM node_value_ledger
    `);

    const netNodes = Number(mismatch.rows[0].net_nodes);
    const netTreasury = Number(mismatch.rows[0].net_treasury);

    if (netNodes !== netTreasury) {
      console.error(`[CRITICAL] RECON MISMATCH: Nodes(${netNodes}) vs Treasury(${netTreasury})`);
      // Optional: Add fraud alert hook here
    } else {
      console.log('[RECON] NODE_VALUE_BALANCED');
    }

  } catch (err) {
    console.error('[RECON ERROR]', err.message);
  }
}

// 2. THE RETAINER (The Schedule)
async function tick() {
  const now = new Date();
  // Only execute at the midnight hour
  if (now.getHours() !== 0) return;

  await runReconciliation();
}

// 3. THE INITIALIZER
function start() {
  if (interval) return;

  // Checks every hour if it is midnight yet
  interval = monitoredInterval('nodeReconciliationWorker', tick, 60 * 60 * 1000);

  console.log('[NODE RECON WORKER] ACTIVE (Midnight Schedule)');
}

module.exports = { start };

