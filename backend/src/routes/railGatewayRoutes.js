const express = require('express');
const router = express.Router();

const {
  executeRail
} = require('../controllers/railGatewayController');

const institutionAuth =
require('../middleware/institutionAuth');

const apiUsageFee = require('../middleware/apiUsageFee');

const requestSignerVerify =
require('../middleware/requestSignerVerify');

const institutionRateLimiter =
require('../middleware/institutionRateLimiter');

// -------------------------------------
// UNIFIED RAIL ENTRY
// -------------------------------------
router.post(
  '/rail/v1/execute',
  institutionAuth,
  apiUsageFee,
  requestSignerVerify,
  institutionRateLimiter,
  executeRail
);

module.exports = router;