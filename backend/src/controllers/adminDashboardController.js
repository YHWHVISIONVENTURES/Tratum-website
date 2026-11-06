// =======================================================
// FILE: src/controllers/adminDashboardController.js
// =======================================================
const pool = require('../db');

// We call the 5 "Brains" (Engines) we built earlier
const { buildSovereignMetrics } = require('../engines/sovereignMetricsEngine');
const { buildTreasuryTelemetry } = require('../analytics/treasuryIntelligenceEngine');
const { buildNodeObservability } = require('../analytics/nodeObservabilityEngine');
const { buildFraudIntelligence } = require('../analytics/fraudRiskEngine');
const { buildInstitutionEconomics } = require('../analytics/institutionalEconomicsEngine');

// 1. Guide for the OPS Room (How is the country doing?)
exports.getOpsDashboard = async (req, res) => {
  const data = await buildSovereignMetrics();
  res.json({ ok: true, data });
};

// 2. Guide for the TREASURY Room (How much gold is in the vault?)
exports.getTreasuryDashboard = async (req, res) => {
  const data = await buildTreasuryTelemetry();
  res.json({ ok: true, data });
};

// 3. Guide for the NODES Room (Are the Nano Banana devices working?)
exports.getNodesDashboard = async (req, res) => {
  const data = await buildNodeObservability();
  res.json({ ok: true, data });
};

exports.getInstitutionsDashboard = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, type, status, created_at FROM institutions ORDER BY created_at DESC, id DESC`
    );
    const institutions = result.rows;
    const active = institutions.filter((item) => String(item.status).toLowerCase() === 'active').length;
    return res.json({
      ok: true,
      summary: { total: institutions.length, active, disabled: institutions.length - active },
      institutions
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'INSTITUTIONS_QUERY_FAILED' });
  }
};
// 4. Guide for the BILLING Room (How much tax/fees are we making?)
exports.getBillingDashboard = async (req, res) => {
  const data = await buildInstitutionEconomics();
  res.json({ ok: true, data });
};

// 5. Guide for the SECURITY Room (Are we under attack?)
exports.getSecurityDashboard = async (req, res) => {
  const data = await buildFraudIntelligence();
  res.json({ ok: true, data });
};

// 6. Guide for the LOGS Room (Show me every single movement record)
exports.getLogsDashboard = async (req, res) => {
  const logs = await pool.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50');
  res.json({ ok: true, logs: logs.rows });
};

// This helps the router find these functions
module.exports = {
  getOpsDashboard: exports.getOpsDashboard,
  getTreasuryDashboard: exports.getTreasuryDashboard,
  getNodesDashboard: exports.getNodesDashboard,
  getInstitutionsDashboard: exports.getInstitutionsDashboard,
  getBillingDashboard: exports.getBillingDashboard,
  getSecurityDashboard: exports.getSecurityDashboard,
  getLogsDashboard: exports.getLogsDashboard
};





