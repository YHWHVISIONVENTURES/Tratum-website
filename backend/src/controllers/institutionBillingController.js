// =======================================================
// FILE: src/controllers/institutionBillingController.js
// STEP 4 - INSTITUTION BILLING DASHBOARD
// PRODUCTION GRADE
// =======================================================

const pool = require('../db');

function num(v) {
  return Number(v || 0);
}

// -------------------------------------------------------
// GET BILLING DASHBOARD
// GET /admin/dashboard/billing
// -------------------------------------------------------
exports.getInstitutionBillingDashboard =
async (req, res) => {
  try {

    const {
      institution_id,
      month,
      year
    } = req.query;

    const now = new Date();

    const y =
      Number(year) ||
      now.getFullYear();

    const m =
      Number(month) ||
      (now.getMonth() + 1);

    const from =
      `${y}-${String(m).padStart(2,'0')}-01`;

    const to =
      m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2,'0')}-01`;

    const filters = [];
    const values = [from, to];
    let p = 3;

    if (institution_id) {
      filters.push(`actor_id = $${p++}`);
      values.push(institution_id);
    }

    const whereExtra =
      filters.length
        ? `AND ${filters.join(' AND ')}`
        : '';

    // ------------------------------------
    // PARALLEL QUERIES
    // ------------------------------------
    const [
      totals,
      feeMix,
      unpaid,
      topInst,
      invoices,
      apiUsage
    ] = await Promise.all([

      // TOTALS
      pool.query(
        `
        SELECT
          COALESCE(SUM(amount),0) total_billed,

          COALESCE(SUM(
            CASE
              WHEN paid = TRUE
              THEN amount ELSE 0
            END
          ),0) total_paid,

          COALESCE(SUM(
            CASE
              WHEN paid = FALSE
              THEN amount ELSE 0
            END
          ),0) total_unpaid

        FROM billing_ledger
        WHERE created_at >= $1
        AND created_at < $2
        ${whereExtra}
        `,
        values
      ),

      // FEE MIX
      pool.query(
        `
        SELECT
          fee_code,
          COUNT(*)::int AS volume,
          COALESCE(SUM(amount),0) total
        FROM billing_ledger
        WHERE created_at >= $1
        AND created_at < $2
        ${whereExtra}
        GROUP BY fee_code
        ORDER BY total DESC
        `,
        values
      ),

      // UNPAID COUNTS
      pool.query(
        `
        SELECT
          COUNT(*)::int AS count
        FROM billing_ledger
        WHERE paid = FALSE
        AND created_at >= $1
        AND created_at < $2
        ${whereExtra}
        `,
        values
      ),

      // TOP INSTITUTIONS
      pool.query(
        `
        SELECT
          actor_id,
          COALESCE(SUM(amount),0) total
        FROM billing_ledger
        WHERE created_at >= $1
        AND created_at < $2
        GROUP BY actor_id
        ORDER BY total DESC
        LIMIT 10
        `,
        [from, to]
      ),

      // INVOICE VIEW
      pool.query(
        `
        SELECT
          id,
          actor_id,
          actor_type,
          fee_code,
          amount,
          paid,
          created_at
        FROM billing_ledger
        WHERE created_at >= $1
        AND created_at < $2
        ${whereExtra}
        ORDER BY id DESC
        LIMIT 100
        `,
        values
      ),

      // API USAGE ONLY
      pool.query(
        `
        SELECT
          actor_id,
          COUNT(*)::int calls,
          COALESCE(SUM(amount),0) total
        FROM billing_ledger
        WHERE fee_code='API_CALL'
        AND created_at >= $1
        AND created_at < $2
        GROUP BY actor_id
        ORDER BY calls DESC
        LIMIT 20
        `,
        [from, to]
      )
    ]);

    // ------------------------------------
    // RESPONSE
    // ------------------------------------
    return res.json({
      ok: true,
      dashboard: 'INSTITUTION_BILLING',

      period: {
        from,
        to
      },

      summary: {
        total_billed:
          num(totals.rows[0]?.total_billed),

        total_paid:
          num(totals.rows[0]?.total_paid),

        unpaid_balance:
          num(totals.rows[0]?.total_unpaid),

        unpaid_items:
          num(unpaid.rows[0]?.count)
      },

      analytics: {
        fee_mix:
          feeMix.rows,

        top_institutions:
          topInst.rows,

        api_usage:
          apiUsage.rows
      },

      invoices:
        invoices.rows
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};