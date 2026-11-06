// =======================================================
// FILE: src/controllers/logsDashboardController.js
// STEP 7 — LOGS DASHBOARD
// FULL PRODUCTION GRADE
// =======================================================

const pool = require('../db');

function safeInt(v, d = 100) {
  const n = Number(v);
  if (Number.isNaN(n)) return d;
  return n;
}

// -------------------------------------------------------
// MAIN LOG DASHBOARD
// GET /admin/dashboard/logs
// -------------------------------------------------------
exports.getLogsDashboard =
async (req, res) => {
  try {

    const limit =
      Math.min(
        safeInt(req.query.limit, 100),
        500
      );

    const [
      systemLogs,
      workerLogs,
      securityLogs,
      apiLogs,
      settlementLogs
    ] = await Promise.all([

      pool.query(
        `
        SELECT *
        FROM system_logs
        ORDER BY id DESC
        LIMIT $1
        `,
        [limit]
      ),

      pool.query(
        `
        SELECT *
        FROM worker_logs
        ORDER BY id DESC
        LIMIT $1
        `,
        [limit]
      ),

      pool.query(
        `
        SELECT *
        FROM security_events
        ORDER BY id DESC
        LIMIT $1
        `,
        [limit]
      ),

      pool.query(
        `
        SELECT *
        FROM api_audit_logs
        ORDER BY id DESC
        LIMIT $1
        `,
        [limit]
      ),

      pool.query(
        `
        SELECT
          cycle_id,
          status,
          tx_count,
          dispatched_at,
          created_at
        FROM bank_settlements
        ORDER BY id DESC
        LIMIT $1
        `,
        [limit]
      )
    ]);

    return res.json({
      ok: true,
      dashboard: 'LOGS',

      feeds: {
        system: systemLogs.rows,
        workers: workerLogs.rows,
        security: securityLogs.rows,
        api: apiLogs.rows,
        settlements: settlementLogs.rows
      }
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};

// -------------------------------------------------------
// CATEGORY FEED
// GET /admin/dashboard/logs/:type
// -------------------------------------------------------
exports.getLogsByType =
async (req, res) => {
  try {

    const { type } = req.params;

    const limit =
      Math.min(
        safeInt(req.query.limit, 100),
        500
      );

    const map = {
      system: 'system_logs',
      workers: 'worker_logs',
      api: 'api_audit_logs',
      security: 'security_events'
    };

    if (!map[type]) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_LOG_TYPE'
      });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM ${map[type]}
      ORDER BY id DESC
      LIMIT $1
      `,
      [limit]
    );

    return res.json({
      ok: true,
      type,
      rows: result.rows
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};