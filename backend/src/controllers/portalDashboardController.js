const billing =
require('./institutionBillingController');

const nodes =
require('./nodeFleetController');

const security =
require('./fraudSecurityController');

const logs =
require('./logsDashboardController');

const pool =
require('../db');

// --------------------------------------------------
// OVERVIEW
// /portal/dashboard/overview
// --------------------------------------------------
exports.getOverview = async (req, res) => {
  try {

    const institutionId =
      req.institution?.id;

    if (!institutionId) {
      return res.status(401).json({
        ok:false,
        error:'UNAUTHORIZED'
      });
    }

    const [
      devices,
      tx,
      pending,
      billingTotal
    ] = await Promise.all([

      pool.query(
        `
        SELECT COUNT(*)::int count
        FROM device_registry
        WHERE issuer_id = $1
        `,
        [institutionId]
      ),

      pool.query(
        `
        SELECT COUNT(*)::int count
        FROM billing_ledger
        WHERE actor_id = $1
        `,
        [institutionId]
      ),

      pool.query(
        `
        SELECT COUNT(*)::int count
        FROM offline_settlement_queue
        WHERE actor_id = $1
        AND processed = FALSE
        `,
        [institutionId]
      ),

      pool.query(
        `
        SELECT COALESCE(
          SUM(amount),0
        ) total
        FROM billing_ledger
        WHERE actor_id = $1
        `,
        [institutionId]
      )
    ]);

    return res.json({
      ok:true,
      dashboard:'PORTAL_OVERVIEW',

      summary:{
        institution_id:
          institutionId,

        active_nodes:
          Number(
            devices.rows[0].count
          ),

        ledger_events:
          Number(
            tx.rows[0].count
          ),

        pending_sync:
          Number(
            pending.rows[0].count
          ),

        billed_total:
          Number(
            billingTotal
            .rows[0].total
          )
      }
    });

  } catch(err) {

    return res.status(500).json({
      ok:false,
      error:err.message
    });

  }
};

// --------------------------------------------------
// BILLING
// --------------------------------------------------
exports.getBilling = async (req, res) => {

  req.query.institution_id =
    req.institution?.id;

  return billing
    .getInstitutionBillingDashboard(
      req,res
    );
};

// --------------------------------------------------
// NODES
// --------------------------------------------------
exports.getNodes = async (req, res) => {

  req.query.issuer_id =
    req.institution?.id;

  return nodes
    .getNodeFleetDashboard(
      req,res
    );
};

// --------------------------------------------------
// SECURITY
// --------------------------------------------------
exports.getSecurity =
async (req,res) => {

  req.query.institution_id =
    req.institution?.id;

  return security
    .getFraudSecurityDashboard(
      req,res
    );
};

// --------------------------------------------------
// LOGS
// --------------------------------------------------
exports.getLogs =
async (req,res) => {

  req.query.institution_id =
    req.institution?.id;

  return logs
    .getLogsDashboard(
      req,res
    );
};
