const express = require('express');
const router = express.Router();

const {
  injectFiat,
  getFloat
} = require('../controllers/fiatController');

const institutionAuth =
require('../middleware/institutionAuth');

const requestSignerVerify =
require('../middleware/requestSignerVerify');

const institutionRateLimiter =
require('../middleware/institutionRateLimiter');

// ------------------------------------
// PROTECTED VALUE CREATION ENDPOINT
// ------------------------------------
router.post(
  '/rail/v1/fiat/inject',
  institutionAuth,
  requestSignerVerify,
  institutionRateLimiter,
  injectFiat
);

// ------------------------------------
// READ ENDPOINT
// ------------------------------------
router.get(
  '/rail/v1/fiat/float/:institution/:currency',
  institutionAuth,
  getFloat
);

module.exports = router;