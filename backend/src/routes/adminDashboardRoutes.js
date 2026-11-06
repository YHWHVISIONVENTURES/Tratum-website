// =====================================================
// FILE: src/routes/adminDashboardRoutes.js
// RBAC PROTECTION EXAMPLE
// =====================================================

const express = require('express');
const router = express.Router();

const adminAuth = require('../middleware/adminAuth');
const requirePermission = require('../middleware/requirePermission');

const ctrl = require('../controllers/adminDashboardController');
const billing = require('../controllers/institutionBillingController');

/*
SUPER ADMIN CONTROL PLANE
*/

router.get(
  '/admin/v1/dashboard/ops',
  adminAuth,
  requirePermission('OPS_VIEW'),
  ctrl.getOpsDashboard
);

router.get(
  '/admin/v1/dashboard/treasury',
  adminAuth,
  requirePermission('TREASURY_VIEW'),
  ctrl.getTreasuryDashboard
);

router.get(
  '/admin/v1/dashboard/nodes',
  adminAuth,
  requirePermission('NODES_VIEW'),
  ctrl.getNodesDashboard
);

router.get(
  '/admin/v1/dashboard/billing',
  adminAuth,
  requirePermission('BILLING_VIEW'),
  billing.getInstitutionBillingDashboard
);

router.get(
  '/admin/v1/dashboard/security',
  adminAuth,
  requirePermission('SECURITY_VIEW'),
  ctrl.getSecurityDashboard
);

router.get(
  '/admin/v1/dashboard/institutions',
  adminAuth,
  requirePermission('INSTITUTIONS_VIEW'),
  ctrl.getInstitutionsDashboard
);

router.get(
  '/admin/v1/dashboard/logs',
  adminAuth,
  requirePermission('LOGS_VIEW'),
  ctrl.getLogsDashboard
);

module.exports = router;




