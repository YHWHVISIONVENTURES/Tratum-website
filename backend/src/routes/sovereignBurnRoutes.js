const express = require('express');
const router = express.Router();

const {
  burnSovereign,
  getBurnHistory
} = require('../controllers/sovereignBurnController');

const institutionAuth =
require('../middleware/institutionAuth');

const requestSignerVerify =
require('../middleware/requestSignerVerify');

const institutionRateLimiter =
require('../middleware/institutionRateLimiter');

// ------------------------------------
// SOREIGN BURN ENDPOINT (PROTECTED)
// ------------------------------------
router.post(
  '/rail/v1/sovereign/burn',
  institutionAuth,
  requestSignerVerify,
  institutionRateLimiter,
  burnSovereign
);

// ------------------------------------
// BURN HISTORY
// ------------------------------------
router.get(
  '/rail/v1/sovereign/burn/:sovereign/:currency',
  institutionAuth,
  getBurnHistory
);

module.exports = router;