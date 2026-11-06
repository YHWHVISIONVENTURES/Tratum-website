const express = require('express');
const router = express.Router();

// 1. Import Middleware & Controllers
const institutionAuth = require('../middleware/institutionAuth');
const requestSignerVerify = require('../middleware/requestSignerVerify');
const institutionRateLimiter = require('../middleware/institutionRateLimiter');
const institutionController = require('../controllers/institutionController');
const syncController = require('../controllers/syncController');

// =====================================================
// AUTH TEST ENDPOINT
// Used by partners to verify their API Key works
// =====================================================
router.post('/api/v1/institution/test', institutionAuth, (req, res) => {
  res.json({
    ok: true,
    institution: req.institution.name,
    status: "AUTH_SUCCESS"
  });
});

// =====================================================
// TRANSACTION SUBMISSION
// Secure route for institutional ledger entry
// =====================================================
router.post(
  '/api/v1/institution/transaction',
  institutionAuth,
  requestSignerVerify,   // Verify request signature
  institutionRateLimiter,
  institutionController.submitTransaction
);

// =====================================================
// SETTLEMENT FINALIZATION (CA VERIFIED)
// Nodes use this to anchor their local state
// =====================================================
router.post(
  '/api/v1/institution/verify/ca',
  institutionAuth,
  requestSignerVerify,
  institutionRateLimiter,
  syncController.verifySettlementProofCA
);

module.exports = router;
