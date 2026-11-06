// =======================================================
// FILE: src/controllers/institutionsDashboardController.js
// FIXED FOR REAL PK = institution_id
// =======================================================

const pool = require('../db');

function num(v) {
  return Number(v || 0);
}

// -------------------------------------------------------
// GET INSTITUTIONS DASHBOARD
// GET /admin/dashboard/institutions
// -------------------------------------------------------
exports.getInstitutionsDashboard = async (req, res) => {
  try {
    const {
      type,
      status,
      limit = 100
    } = req.query;

    const filters = [];
    const values = [];
    let p = 1;

    if (type) {
      filters.push(`i.type = $${p++}`);
      values.push(type);
    }

    if (status) {
      filters.push(`i.status = $${p++}`);
      values.push(status);
    }

    const whereClause =
      filters.length
        ? `WHERE ${filters.join(' AND ')}`
        : '';

    const safeLimit = Math.min(Number(limit) || 100, 500);

    // ---------------------------------------------------
    // RUN PARALLEL QUERIES
    // ---------------------------------------------------
    const [
      summary,
      topRevenue,
      apiUsage,
      fleet,
      institutions
    ] = await Promise.all([

      // SUMMARY
      pool.query(
        `
        SELECT
          COUNT(*)::int AS total,

          COUNT(*) FILTER (
            WHERE i.status = 'active'
          )::int AS active,

          COUNT(*) FILTER (
            WHERE i.status = 'disabled'
          )::int AS disabled

        FROM institutions i
        ${whereClause}
        `,
        values
      ),

      // TOP REVENUE
      pool.query(
        `
        SELECT
          actor_id AS institution_id,
          COALESCE(SUM(amount),0) AS total
        FROM billing_ledger
        WHERE actor_type='BANK'
        GROUP BY actor_id
        ORDER BY total DESC
        LIMIT 10
        `
      ),

      // API USAGE
      pool.query(
        `
        SELECT
          actor_id AS institution_id,
          COUNT(*)::int AS calls,
          COALESCE(SUM(amount),0) AS fees
        FROM billing_ledger
        WHERE fee_code='API_CALL'
        GROUP BY actor_id
        ORDER BY calls DESC
        LIMIT 10
        `
      ),

      // NODE FLEET
      pool.query(
        `
        SELECT
          issuer_id AS institution_id,
          COUNT(*)::int AS nodes
        FROM device_registry
        GROUP BY issuer_id
        ORDER BY nodes DESC
        LIMIT 10
        `
      ),

      // FULL TABLE
      pool.query(
        `
        SELECT
          i.institution_id,
          i.name,
          i.type,
          i.status,
          i.created_at,

          COALESCE(b.total_billed,0)
            AS total_billed,

          COALESCE(n.nodes,0)
            AS nodes,

          COALESCE(a.calls,0)
            AS api_calls

        FROM institutions i

        LEFT JOIN (
          SELECT
            actor_id,
            SUM(amount) AS total_billed
          FROM billing_ledger
          GROUP BY actor_id
        ) b
          ON b.actor_id = i.institution_id::text

        LEFT JOIN (
          SELECT
            issuer_id,
            COUNT(*) AS nodes
          FROM device_registry
          GROUP BY issuer_id
        ) n
          ON n.issuer_id = i.institution_id::text

        LEFT JOIN (
          SELECT
            actor_id,
            COUNT(*) AS calls
          FROM billing_ledger
          WHERE fee_code='API_CALL'
          GROUP BY actor_id
        ) a
          ON a.actor_id = i.institution_id::text

        ${whereClause}

        ORDER BY i.institution_id DESC
        LIMIT ${safeLimit}
        `,
        values
      )
    ]);

    return res.json({
      ok: true,
      dashboard: 'INSTITUTIONS',

      summary: {
        total: num(summary.rows[0]?.total),
        active: num(summary.rows[0]?.active),
        disabled: num(summary.rows[0]?.disabled)
      },

      analytics: {
        top_revenue: topRevenue.rows,
        top_api_usage: apiUsage.rows,
        top_node_fleet: fleet.rows
      },

      institutions: institutions.rows
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};