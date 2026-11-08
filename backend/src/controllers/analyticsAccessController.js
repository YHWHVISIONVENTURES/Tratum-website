// =======================================================
// FILE: src/controllers/analyticsAccessController.js
// ROLE-SCOPED OBSERVABILITY GATEWAY
// =======================================================

const {
  getCachedSnapshot
} = require('../analytics/snapshotPipelineEngine');

const {
  buildSovereignMetrics
} = require('../engines/sovereignMetricsEngine');

const {
  buildTreasuryIntelligence
} = require('../analytics/treasuryIntelligenceEngine');

const {
  buildCorridorAnalytics
} = require('../analytics/corridorAnalyticsEngine');

const {
  buildNodeObservability
} = require('../analytics/nodeObservabilityEngine');

const {
  buildFraudRiskAnalytics
} = require('../analytics/fraudRiskEngine');

const {
  buildInstitutionEconomics
} = require('../analytics/institutionalEconomicsEngine');

// =======================================================
// PERMISSION MAP
// =======================================================

const ACCESS = {

  OPS_VIEW: [
    'sovereign',
    'corridors',
    'nodes'
  ],

  TREASURY_VIEW: [
    'treasury'
  ],

  SECURITY_VIEW: [
    'fraud',
    'nodes'
  ],

  BILLING_VIEW: [
    'economics'
  ],

  INSTITUTIONS_VIEW: [
    'economics',
    'corridors'
  ],

  NODES_VIEW: [
    'nodes'
  ]
};

// =======================================================
// HELPERS
// =======================================================

function hasAccess(req, scope) {

  const permissions =
    req.admin?.permissions || [];

  return permissions.some(
    perm =>
      ACCESS[perm]?.includes(scope)
  );
}

function deny(res) {

  return res.status(403).json({
    ok: false,
    error: 'ACCESS_DENIED'
  });
}

// =======================================================
// GET SNAPSHOT
// =======================================================
// GET /admin/v1/analytics/snapshot/:window
// =======================================================

exports.getSnapshot =
async (req, res) => {

  try {

    const {
      window = '1m'
    } = req.params;

    const snapshot =
      getCachedSnapshot(window);

    return res.json({
      ok: true,
      snapshot
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};

// =======================================================
// SOVEREIGN METRICS
// =======================================================
// GET /admin/v1/analytics/sovereign
// =======================================================

exports.getSovereignMetrics =
async (req, res) => {

  try {

    if (
      !hasAccess(req, 'sovereign')
    ) {
      return deny(res);
    }

    const metrics =
      await buildSovereignMetrics();

    return res.json({
      ok: true,
      analytics: 'SOVEREIGN_METRICS',
      metrics
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};

// =======================================================
// TREASURY INTELLIGENCE
// =======================================================
// GET /admin/v1/analytics/treasury
// =======================================================

exports.getTreasuryIntelligence =
async (req, res) => {

  try {

    if (
      !hasAccess(req, 'treasury')
    ) {
      return deny(res);
    }

    const analytics =
      await buildTreasuryIntelligence();

    return res.json({
      ok: true,
      analytics: 'TREASURY_INTELLIGENCE',
      data: analytics
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};

// =======================================================
// CORRIDOR ANALYTICS
// =======================================================
// GET /admin/v1/analytics/corridors
// =======================================================

exports.getCorridorAnalytics =
async (req, res) => {

  try {

    if (
      !hasAccess(req, 'corridors')
    ) {
      return deny(res);
    }

    const analytics =
      await buildCorridorAnalytics();

    return res.json({
      ok: true,
      analytics: 'CORRIDOR_ANALYTICS',
      data: analytics
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};

// =======================================================
// NODE OBSERVABILITY
// =======================================================
// GET /admin/v1/analytics/nodes
// =======================================================

exports.getNodeObservability =
async (req, res) => {

  try {

    if (
      !hasAccess(req, 'nodes')
    ) {
      return deny(res);
    }

    const analytics =
      await buildNodeObservability();

    return res.json({
      ok: true,
      analytics: 'NODE_OBSERVABILITY',
      data: analytics
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};

// =======================================================
// FRAUD RISK
// =======================================================
// GET /admin/v1/analytics/fraud
// =======================================================

exports.getFraudRisk =
async (req, res) => {

  try {

    if (
      !hasAccess(req, 'fraud')
    ) {
      return deny(res);
    }

    const analytics =
      await buildFraudRiskAnalytics();

    return res.json({
      ok: true,
      analytics: 'FRAUD_RISK',
      data: analytics
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};

// =======================================================
// INSTITUTION ECONOMICS
// =======================================================
// GET /admin/v1/analytics/economics
// =======================================================

exports.getInstitutionEconomics =
async (req, res) => {

  try {

    if (
      !hasAccess(req, 'economics')
    ) {
      return deny(res);
    }

    const analytics =
      await buildInstitutionEconomics();

    return res.json({
      ok: true,
      analytics: 'INSTITUTION_ECONOMICS',
      data: analytics
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};
