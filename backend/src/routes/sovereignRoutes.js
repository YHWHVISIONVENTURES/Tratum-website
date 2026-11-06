const express = require('express');
const router = express.Router();

const {
  mintSovereign,
  getSupply
} = require('../controllers/sovereignController');

const apiUsageFee = require('../middleware/apiUsageFee');

const institutionAuth =
require('../middleware/institutionAuth');

const requestSignerVerify =
require('../middleware/requestSignerVerify');

const institutionRateLimiter =
require('../middleware/institutionRateLimiter');

// -----------------------------------
// Sovereign mint endpoint
// -----------------------------------
router.post(
  '/rail/v1/sovereign/mint',
  institutionAuth,
  apiUsageFee,
  requestSignerVerify,
  institutionRateLimiter,
  mintSovereign
);

// -----------------------------------
// Supply check
// -----------------------------------
router.get(
  '/rail/v1/sovereign/supply/:sovereign/:currency',
  institutionAuth,
  getSupply
);

module.exports = router;