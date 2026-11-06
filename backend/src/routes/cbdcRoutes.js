const express = require('express');
const router = express.Router();

const {
  mintCBDC,
  getSupply
} = require('../controllers/cbdcController');

const apiUsageFee = require('../middleware/apiUsageFee');

const institutionAuth =
require('../middleware/institutionAuth');

const requestSignerVerify =
require('../middleware/requestSignerVerify');

const institutionRateLimiter =
require('../middleware/institutionRateLimiter');

// ----------------------------------
router.post(
  '/cbdc/v1/mint',
  institutionAuth,
  apiUsageFee,
  requestSignerVerify,
  institutionRateLimiter,
  mintCBDC
);

router.get(
  '/cbdc/v1/supply/:sovereign/:currency',
  institutionAuth,
  getSupply
);

module.exports = router;