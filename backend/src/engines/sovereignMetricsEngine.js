// =======================================================
// FILE: src/engines/sovereignMetricsEngine.js
// SOVEREIGN MACRO-STATE AGGREGATION ENGINE
// =======================================================

const pool = require('../db');

// -------------------------------------------------------
// HELPERS
// -------------------------------------------------------
function num(v) {
  return Number(v || 0);
}

function safeDivide(a, b) {
  if (!b || b === 0) return 0;
  return Number((a / b).toFixed(4));
}

// -------------------------------------------------------
// BUILD GLOBAL METRICS SNAPSHOT
// -------------------------------------------------------
async function buildSovereignMetrics() {

  // -----------------------------------------------------
  // PARALLEL AGGREGATION
  // -----------------------------------------------------
  const [

    txTotals,
    txVelocity,
    railOps,
    railFailures,
    economicFlow,
    sovereignSupply,
    treasuryFlow,
    institutions,
    devices,
    settlementQueue

  ] = await Promise.all([

    // ---------------------------------------------------
    // TOTAL TRANSACTIONS
    // ---------------------------------------------------
    pool.query(`
      SELECT
        COUNT(*)::bigint AS total_transactions,

        COALESCE(
          SUM(amount),0
        ) AS total_volume

      FROM transactions
    `),

    // ---------------------------------------------------
    // TX VELOCITY
    // ---------------------------------------------------
    pool.query(`
      SELECT
        COUNT(*)::int AS tx_last_minute
      FROM transactions
      WHERE created_at >=
        NOW() - INTERVAL '60 seconds'
    `),

    // ---------------------------------------------------
    // RAIL OPERATIONS
    // ---------------------------------------------------
    pool.query(`
      SELECT
        COUNT(*)::bigint AS total_ops
      FROM rail_transactions
    `),

    // ---------------------------------------------------
    // FAILED RAIL OPS
    // ---------------------------------------------------
    pool.query(`
      SELECT
        COUNT(*)::int AS failed_ops
      FROM rail_transactions
      WHERE status='FAILED'
    `),

    // ---------------------------------------------------
    // ECONOMIC FLOW
    // ---------------------------------------------------
    pool.query(`
      SELECT
        event_type,

        COUNT(*)::int AS count,

        COALESCE(
          SUM(amount),0
        ) AS total

      FROM economic_events

      GROUP BY event_type
      ORDER BY total DESC
    `),

    // ---------------------------------------------------
    // SOVEREIGN SUPPLY
    // ---------------------------------------------------
    pool.query(`
      SELECT
        currency_code,
        total_issued
      FROM sovereign_supply
      ORDER BY currency_code ASC
    `),

    // ---------------------------------------------------
    // TREASURY FLOW
    // ---------------------------------------------------
    pool.query(`
      SELECT

        currency_code,

        COALESCE(
          SUM(
            CASE
              WHEN direction='CREDIT'
              THEN amount
              ELSE 0
            END
          ),0
        ) AS credits,

        COALESCE(
          SUM(
            CASE
              WHEN direction='DEBIT'
              THEN amount
              ELSE 0
            END
          ),0
        ) AS debits

      FROM treasury_ledger

      GROUP BY currency_code
      ORDER BY currency_code ASC
    `),

    // ---------------------------------------------------
    // ACTIVE INSTITUTIONS
    // ---------------------------------------------------
    pool.query(`
      SELECT
        COUNT(*)::int AS active_institutions
      FROM institutions
      WHERE status='active'
    `),

    // ---------------------------------------------------
    // DEVICE NETWORK
    // ---------------------------------------------------
    pool.query(`
      SELECT

        COUNT(*)::int AS total_devices,

        COUNT(*) FILTER (
          WHERE status='ACTIVE'
        )::int AS active_devices

      FROM devices
    `),

    // ---------------------------------------------------
    // PENDING OFFLINE SETTLEMENTS
    // ---------------------------------------------------
    pool.query(`
      SELECT
        COUNT(*)::int AS pending_sync
      FROM offline_settlement_queue
      WHERE processed = FALSE
    `)
  ]);

  // -----------------------------------------------------
  // EXTRACT
  // -----------------------------------------------------
  const totalTransactions =
    num(txTotals.rows[0]?.total_transactions);

  const totalVolume =
    num(txTotals.rows[0]?.total_volume);

  const txLastMinute =
    num(txVelocity.rows[0]?.tx_last_minute);

  const totalRailOps =
    num(railOps.rows[0]?.total_ops);

  const failedRailOps =
    num(railFailures.rows[0]?.failed_ops);

  const activeInstitutions =
    num(institutions.rows[0]?.active_institutions);

  const totalDevices =
    num(devices.rows[0]?.total_devices);

  const activeDevices =
    num(devices.rows[0]?.active_devices);

  const pendingSync =
    num(settlementQueue.rows[0]?.pending_sync);

  // -----------------------------------------------------
  // DERIVED METRICS
  // -----------------------------------------------------
  const txPerSecond =
    Number((txLastMinute / 60).toFixed(2));

  const railFailureRate =
    safeDivide(
      failedRailOps,
      totalRailOps
    );

  const activeDeviceRatio =
    safeDivide(
      activeDevices,
      totalDevices
    );

  const sovereignHealthScore =
    Math.max(
      0,
      Math.min(
        100,

        (
          (txPerSecond > 0 ? 20 : 5) +

          (pendingSync === 0 ? 20 : 10) +

          (railFailureRate < 0.05 ? 20 : 10) +

          (activeDeviceRatio > 0.8 ? 20 : 10) +

          (activeInstitutions > 0 ? 20 : 0)
        )
      )
    );

  // -----------------------------------------------------
  // BUILD SNAPSHOT
  // -----------------------------------------------------
  return {

    generated_at:
      new Date().toISOString(),

    sovereign_state: {

      health_score:
        sovereignHealthScore,

      active_institutions:
        activeInstitutions,

      total_devices:
        totalDevices,

      active_devices:
        activeDevices,

      active_device_ratio:
        activeDeviceRatio,

      pending_settlement_sync:
        pendingSync
    },

    transactions: {

      total_transactions:
        totalTransactions,

      total_volume:
        totalVolume,

      tx_last_minute:
        txLastMinute,

      tx_per_second:
        txPerSecond
    },

    rails: {

      total_operations:
        totalRailOps,

      failed_operations:
        failedRailOps,

      failure_rate:
        railFailureRate
    },

    sovereign_supply:
      sovereignSupply.rows,

    treasury_flow:
      treasuryFlow.rows,

    economic_activity:
      economicFlow.rows
  };
}

// -------------------------------------------------------
// EXPORTS
// -------------------------------------------------------
module.exports = {
  buildSovereignMetrics
};