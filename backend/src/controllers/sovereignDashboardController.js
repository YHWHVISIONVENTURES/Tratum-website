// ===================================================
// FILE: src/controllers/sovereignDashboardController.js
// UPGRADED TO GLOBAL OPS DASHBOARD (PRODUCTION)
// ===================================================

const pool = require('../db');

// -------------------------------------------
// SAFE NUMERIC
// -------------------------------------------
function num(v) {
  return Number(v || 0);
}

// -------------------------------------------
// GET GLOBAL OPS DASHBOARD
// GET /admin/dashboard/global
// -------------------------------------------
exports.getSystemDashboard = async (req, res) => {
  try {

    const {
      currency_code = 'CBDC'
    } = req.query;

    // ---------------------------------------
    // RUN PARALLEL QUERIES
    // ---------------------------------------
    const [
      supplyResult,
      mintBurn,
      devices,
      ledger,
      rail,
      pendingSync,
      feesToday,
      txToday,
      txRecent,
      finality,
      institutions,
      failedJobs
    ] = await Promise.all([

      // SUPPLY
      pool.query(
        `SELECT total_issued
         FROM sovereign_supply
         WHERE currency_code=$1
         LIMIT 1`,
        [currency_code]
      ),

      // MINT / BURN
      pool.query(
        `SELECT
          COALESCE(SUM(
            CASE
              WHEN event_type='MINT'
              THEN amount ELSE 0
            END
          ),0) AS minted,

          COALESCE(SUM(
            CASE
              WHEN event_type='BURN'
              THEN amount ELSE 0
            END
          ),0) AS burned

         FROM sovereign_events
         WHERE currency_code=$1`,
        [currency_code]
      ),

      // ACTIVE DEVICES
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM devices
         WHERE status='ACTIVE'`
      ),

      // TOTAL LEDGER TX
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM transactions`
      ),

      // RAIL OPS
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM rail_transactions`
      ),

        // PENDING SYNC QUEUE
        pool.query(
        `SELECT COUNT(*)::int AS count
         FROM offline_settlement_queue
         WHERE processed = FALSE`
      ),

      // FEES TODAY
      pool.query(
        `SELECT COALESCE(
          SUM(gross_amount),0
         ) AS total
         FROM revenue_events
         WHERE created_at >=
           CURRENT_DATE`
      ),

      // TX TODAY
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM transactions
         WHERE created_at >=
           CURRENT_DATE`
      ),

      // TX LAST 60 SECONDS
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM transactions
         WHERE created_at >=
           NOW() - INTERVAL '60 seconds'`
      ),

      // FINALITY
      pool.query(
        `SELECT cycle_id,
                status,
                created_at
         FROM bank_settlements
         ORDER BY id DESC
         LIMIT 1`
      ),

      // ACTIVE INSTITUTIONS
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM institutions
         WHERE status='active'`
      ),

      // FAILED JOBS
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM rail_transactions
         WHERE status='FAILED'`
      )
    ]);

    // ---------------------------------------
    // EXTRACT VALUES
    // ---------------------------------------
    const totalSupply =
      num(supplyResult.rows[0]?.total_issued);

    const minted =
      num(mintBurn.rows[0]?.minted);

    const burned =
      num(mintBurn.rows[0]?.burned);

    const netSupply =
      minted - burned;

    const activeDevices =
      num(devices.rows[0]?.count);

    const ledgerTx =
      num(ledger.rows[0]?.count);

    const railOps =
      num(rail.rows[0]?.count);

    const pendingQueues =
      num(pendingSync.rows[0]?.count);

    const fees =
      num(feesToday.rows[0]?.total);

    const todayTx =
      num(txToday.rows[0]?.count);

    const txPerSec =
      Number(
        (
          num(txRecent.rows[0]?.count) / 60
        ).toFixed(2)
      );

    const activeInstitutions =
      num(institutions.rows[0]?.count);

    const failed =
      num(failedJobs.rows[0]?.count);

    const latestFinality =
      finality.rows[0] || null;

    // ---------------------------------------
    // HEALTH SCORE
    // ---------------------------------------
    const healthScore =
      Math.max(
        0,
        Math.min(
          100,
          (
            (
              activeDevices > 0 ? 30 : 0
            ) +
            (
              pendingQueues === 0 ? 20 : 10
            ) +
            (
              failed === 0 ? 20 : 10
            ) +
            (
              txPerSec > 0 ? 15 : 5
            ) +
            (
              latestFinality ? 15 : 0
            )
          )
        )
      );

    // ---------------------------------------
    // RESPONSE
    // ---------------------------------------
    return res.json({
      ok: true,
      dashboard: 'GLOBAL_OPS',
      currency: currency_code,

      snapshot: {

        supply: {
          total_supply: totalSupply,
          minted,
          burned,
          net_supply: netSupply
        },

        network: {
          active_devices: activeDevices,
          active_institutions: activeInstitutions,
          pending_sync_queues: pendingQueues
        },

        ledger: {
          total_transactions: ledgerTx,
          transactions_today: todayTx,
          tx_per_second: txPerSec
        },

        rails: {
          total_operations: railOps,
          failed_operations: failed
        },

        revenue: {
          fees_today: fees
        },

        finality: latestFinality
          ? {
              cycle_id:
                latestFinality.cycle_id,
              status:
                latestFinality.status,
              created_at:
                latestFinality.created_at
            }
          : null,

        health: {
          score: healthScore
        }
      }
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};