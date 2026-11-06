const pool = require('../db');
const { reconcileOfflineBatch } = require('../services/offlineReconciler');

let interval = null;

async function runWorker() {
  try {
    const pending = await pool.query(
      `SELECT batch_id FROM offline_settlement_queue WHERE status='PENDING'`
    );

    for (let row of pending.rows) {
      await reconcileOfflineBatch(row.batch_id);
    }

  } catch (err) {
    console.error("[OFFLINE WORKER ERROR]", err.message);
  }
}

function start() {
  if (interval) return;

  interval = setInterval(runWorker, 10000);

  console.log("[OFFLINE WORKER] ACTIVE");
}

module.exports = { start };