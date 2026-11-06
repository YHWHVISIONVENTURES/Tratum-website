const { processMerchantSettlements } = require('../services/merchantSettlementEngine');

let interval = null;

async function tick() {
  try {
    await processMerchantSettlements();
  } catch (err) {
    console.error('[MERCHANT_SETTLEMENT_WORKER_ERROR]', err.message);
  }
}

function start() {
  if (interval) return;
  // Run every 15 seconds
  interval = setInterval(tick, 15000);
  console.log('[MERCHANT_SETTLEMENT_WORKER] ACTIVE (15s Pulse)');
}

module.exports = { start };
