const { observe } = require('../services/workerObservation');
const pool = require('../db');

// Import existing domain engines (already built in your system)
const { mintSovereign } = require('../controllers/sovereignController');
const { burnSovereign } = require('../controllers/sovereignBurnController');
const {
  stableLoad,
  stableSpend,
  stableRedeem
} = require('../services/stablecoinBridge');
const {
  registerFinality
} = require('../services/routeFinalityEngine');

const { bundle } = require('../services/feeEngine');

let interval = null;

// -------------------------------------
// FETCH PENDING RAIL OPERATIONS
// -------------------------------------
async function fetchPending() {
  return pool.query(
    `SELECT *
     FROM rail_transactions
     WHERE processed IS NULL
     ORDER BY id ASC
     LIMIT 20`
  );
}

// -------------------------------------
// MARK AS PROCESSED
// -------------------------------------
async function markProcessed(id, status) {
  await pool.query(
    `UPDATE rail_transactions
     SET processed = true,
         status = $2,
         processed_at = NOW()
     WHERE id = $1`,
    [id, status]
  );
}

// -------------------------------------
// DISPATCH CORE LOGIC
// -------------------------------------
async function dispatch(tx) {
  try {

    const { resolveRoute } =
  require('../services/routingEngine');

  const { operation, payload } = tx;
  const enrichedPayload = {
  ...payload,
  route: tx.route || null
};

// =====================================================
    // 🚨 SECURITY HOOK: FRAUD SPIKE DETECTION (TOP HARDENING)
    // =====================================================
    const txAmount = Number(payload.amount || 0);
    if (txAmount > 1000000) { // Threshold: 1 Million
      await pool.query(
        `INSERT INTO fraud_alerts (severity, actor_id, alert_code, details)
         VALUES ('HIGH', $1, 'SUSPICIOUS_SPIKE', $2)`,
        [payload.device_id || 'SYSTEM', JSON.stringify({ amount: txAmount, operation, reference: tx.reference })]
      );
      
      // Also log to security_events for the risk score
      await pool.query(
        `INSERT INTO security_events (actor_id, event_code, metadata)
         VALUES ($1, 'SUSPICIOUS_SPIKE', $2)`,
        [payload.device_id || 'SYSTEM', JSON.stringify({ amount: txAmount, tx_id: tx.id })]
      );
    }
    // =====================================================

    const route = await resolveRoute({
  from_country: tx.payload.from_country || 'NG',
  to_country: tx.payload.to_country || 'NG',
  asset: tx.payload.token || 'USDT'
});

tx.route = route;

await pool.query(
  `UPDATE rail_transactions
   SET route=$1
   WHERE id=$2`,
  [route, tx.id]
);

await registerFinality({
  reference: tx.reference,
  rail_type: route.rail,
  operation: tx.operation,
  route,
  required_confirmations: 1
});

// =====================================================
    // 4. TOP HARDENING: FEE CALCULATION & BALANCE CHECK
    // =====================================================
    const fees = await bundle(['NODE_GAS'], payload.amount);
    const totalRequired = Number(payload.amount) + fees.total_fee;

    // We assume you have a getBalance helper; if not, use this inline check:
    const balRes = await pool.query(
      `SELECT balance FROM stablecoin_balances WHERE device_id = $1 AND token = $2`,
      [payload.device_id, payload.token || 'USDT']
    );
    const walletBalance = Number(balRes.rows[0]?.balance || 0);

    if (walletBalance < totalRequired) {
      throw new Error('INSUFFICIENT_BALANCE_WITH_FEES');
    }
    
    // Attach fee data to payload so the engine knows how much to deduct
    payload.fee_breakdown = fees;
    // =====================================================

    // -----------------------------
    // ROUTING ENGINE
    // -----------------------------
    if (operation === 'MINT') {

      await mintSovereign({
  body: {
    ...payload,
    route
  }
}, {
  json: () => {}
        }
      );

await registerFinality({
  reference: tx.reference,
  rail_type: 'CBDC',
  operation: 'MINT',
  route,
  required_confirmations: 1
});

      return await markProcessed(tx.id, 'MINT_OK');
    }

    if (operation === 'BURN') {

      await burnSovereign({
  body: {
    ...payload,
    route
  }
}, {
  json: () => {}
        }
      );

await registerFinality({
  reference: tx.reference,
  rail_type: 'CBDC',
  operation: 'BURN',
  route,
  required_confirmations: 1
});

      return await markProcessed(tx.id, 'BURN_OK');
    }

    if (operation === 'TRANSFER') {

  // future: interbank routing uses route here

  await markProcessed(tx.id, `TRANSFER_OK_${route.rail}`);
}

    if (operation === 'SETTLE') {

  await markProcessed(tx.id, `SETTLE_${route.rail}`);
}

    if (operation === 'STABLE_LOAD') {

  await stableLoad({
  ...payload,
  route
});

  await registerFinality({
  reference: tx.reference,
  rail_type: 'STABLE',
  operation: 'STABLE_LOAD',
  route,
  required_confirmations: 6
});

  return await markProcessed(
    tx.id,
    'STABLE_LOAD_OK'
  );
}

if (operation === 'STABLE_SPEND') {

await bundle(
 ['NODE_GAS','FX_SPREAD'],
 amount
);

  await stableSpend({
  ...payload,
  route
});

await registerFinality({
  reference: tx.reference,
  rail_type: 'STABLE',
  operation: 'STABLE_SPEND',
  route,
  required_confirmations: 6
});



  return await markProcessed(
    tx.id,
    'STABLE_SPEND_OK'
  );
}

if (operation === 'STABLE_REDEEM') {

  await stableRedeem({
  ...payload,
  route
});

await registerFinality({
  reference: tx.reference,
  rail_type: 'STABLE',
  operation: 'STABLE_REDEEM',
  route,
  required_confirmations: 6
});

  return await markProcessed(
    tx.id,
    'STABLE_REDEEM_OK'
  );
}

    return await markProcessed(tx.id, 'UNKNOWN_OP');

  } catch (err) {

    await pool.query(
      `UPDATE rail_transactions

       SET status='FAILED',
           error_message=$2
       WHERE id=$1`,
      [tx.id, err.message]
    );

    console.error('[RAIL DISPATCH ERROR]', err.message);
  }
}

// -------------------------------------
// WORKER LOOP
// -------------------------------------
async function tick() {
  await observe('rail-dispatcher', 'started');
  try {

    const result = await fetchPending();

    for (const tx of result.rows) {
      await dispatch(tx);
    }
    await observe('rail-dispatcher', 'completed');

  } catch (err) {
    await observe('rail-dispatcher', 'failed');
    console.error('[RAIL WORKER ERROR]', err.message);
  }
}

// -------------------------------------
// START WORKER
// -------------------------------------
function start() {

  if (interval) return;

  interval = setInterval(tick, 5000);

  console.log('[RAIL DISPATCHER WORKER] ACTIVE');
}

module.exports = { start };
