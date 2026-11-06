const express = require('express');
const router = express.Router();

const {
  getSovereignAudit,
  getSupplySnapshot,
  getRecentEvents
} = require('../controllers/sovereignAuditController');

const institutionAuth =
require('../middleware/institutionAuth');

// ---------------------------------------------------
// FULL AUDIT STREAM
// ---------------------------------------------------
router.get(
  '/rail/v1/audit/events',
  institutionAuth,
  getSovereignAudit
);

// ---------------------------------------------------
// SUPPLY SNAPSHOT
// ---------------------------------------------------
router.get(
  '/rail/v1/audit/supply',
  institutionAuth,
  getSupplySnapshot
);

// ---------------------------------------------------
// LIVE DASH FEED
// ---------------------------------------------------
router.get(
  '/rail/v1/audit/recent',
  institutionAuth,
  getRecentEvents
);

module.exports = router;