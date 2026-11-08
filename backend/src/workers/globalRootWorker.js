const { monitoredInterval } = require('../services/monitoredInterval');
const pool = require('../db');
const { buildGlobalRoot } = require('../services/globalRootAggregator');

let interval = null;

// -----------------------------------------------------
// PERSIST GLOBAL ROOT
// -----------------------------------------------------
async function persistRoot(root) {

  await pool.query(
    `INSERT INTO sync_state (key, value)
     VALUES ('global_root', $1)
     ON CONFLICT (key)
     DO UPDATE SET value = $1`,
    [root]
  );
}

// -----------------------------------------------------
// WORKER LOOP
// -----------------------------------------------------
async function tick() {

  const root = await buildGlobalRoot();

  if (!root) return;

  await persistRoot(root);

  console.log('[GLOBAL ROOT] Updated:', root);
}

// -----------------------------------------------------
// START WORKER
// -----------------------------------------------------
function start() {

  if (interval) return;

  interval = monitoredInterval('globalRootWorker', tick, 15000); // every 15s

  console.log('[GLOBAL ROOT WORKER] ACTIVE');
}

module.exports = { start };
