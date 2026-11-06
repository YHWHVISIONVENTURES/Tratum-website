const express = require('express');
const router = express.Router();

const {
  createSettlement,
  getSettlements
} = require('../controllers/interbankController');

const apiUsageFee = require('../middleware/apiUsageFee');

const institutionAuth =
require('../middleware/institutionAuth');

const requestSignerVerify =
require('../middleware/requestSignerVerify');

router.post(
  '/rail/v1/interbank/settle',
  institutionAuth,
  apiUsageFee,
  requestSignerVerify,
  createSettlement
);

router.get(
  '/rail/v1/interbank/history',
  institutionAuth,
  apiUsageFee,
  getSettlements
);

module.exports = router;