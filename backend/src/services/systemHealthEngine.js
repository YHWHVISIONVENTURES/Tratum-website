const pool = require('../db');

// ---------------------------------------------------
// LEDGER CONSISTENCY CHECK
// ---------------------------------------------------
async function checkLedgerIntegrity() {

  const result = await pool.query(
    `SELECT COUNT(*)::int AS tx_count,
            SUM(amount)::bigint AS total_volume
     FROM transactions`
  );

  return {
    tx_count: result.rows[0].tx_count,
    total_volume: result.rows[0].total_volume || 0
  };
}

// ---------------------------------------------------
// SUPPLY CONSISTENCY CHECK (CBDC SIDE)
// ---------------------------------------------------
async function checkSupplyIntegrity() {

  const supply = await pool.query(
    `SELECT total_issued
     FROM sovereign_supply
     LIMIT 1`
  );

  const events = await pool.query(
    `SELECT
        SUM(CASE WHEN event_type='MINT' THEN amount ELSE 0 END) AS minted,
        SUM(CASE WHEN event_type='BURN' THEN amount ELSE 0 END) AS burned
     FROM sovereign_events`
  );

  const minted = Number(events.rows[0].minted || 0);
  const burned = Number(events.rows[0].burned || 0);
  const net = minted - burned;

  const declared = Number(supply.rows[0]?.total_issued || 0);

  return {
    minted,
    burned,
    net_supply: net,
    declared_supply: declared,
    mismatch: declared !== net
  };
}

// ---------------------------------------------------
// DEVICE HEALTH SIGNAL
// ---------------------------------------------------
async function checkDeviceHealth() {

  const result = await pool.query(
    `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status='ACTIVE')::int AS active,
        COUNT(*) FILTER (WHERE last_seen < NOW() - INTERVAL '24 hours')::int AS stale
     FROM devices`
  );

  return result.rows[0];
}

// ---------------------------------------------------
// RAIL ACTIVITY ANOMALY CHECK
// ---------------------------------------------------
async function checkRailHealth() {

  const result = await pool.query(
    `SELECT
        COUNT(*)::int AS total_ops,
        COUNT(*) FILTER (WHERE status='FAILED')::int AS failed_ops
     FROM rail_transactions`
  );

  const failureRate =
    result.rows[0].total_ops > 0
      ? (result.rows[0].failed_ops / result.rows[0].total_ops) * 100
      : 0;

  return {
    total_ops: result.rows[0].total_ops,
    failed_ops: result.rows[0].failed_ops,
    failure_rate: Number(failureRate.toFixed(2))
  };
}

// ---------------------------------------------------
// GLOBAL SYSTEM HEALTH SCORE
// ---------------------------------------------------
async function computeSystemHealth() {

  const ledger = await checkLedgerIntegrity();
  const supply = await checkSupplyIntegrity();
  const devices = await checkDeviceHealth();
  const rail = await checkRailHealth();

  // ---------------------------------------------
  // SCORING MODEL (ENGINEERING GRADE)
  // ---------------------------------------------
  let score = 100;

  if (supply.mismatch) score -= 30;
  if (rail.failure_rate > 5) score -= 20;
  if (devices.stale > devices.total * 0.1) score -= 15;

  score = Math.max(0, score);

  return {
    ledger,
    supply,
    devices,
    rail,
    system_health_score: score
  };
}

module.exports = {
  computeSystemHealth
};