const { runSettlementBridge } =
  require('../settlement/settlementBridgeEngine');

let interval = null;
let lock = false;

async function tick() {

  if (lock) return;
  lock = true;

  try {

    const result =
      await runSettlementBridge();

    if (result && result.count > 0) {
  console.log(`[BRIDGE] Processed ${result.count} txs. Total: ${result.total}`);
}


  } catch (err) {
    console.error('[BRIDGE ERROR]', err.message);
  }

  lock = false;
}

function start() {

  if (interval) return;

  interval = setInterval(
    tick,
    10000 // every 10s
  );

  console.log('[SETTLEMENT BRIDGE WORKER] ACTIVE');
}

module.exports = { start };