const express = require('express');
const router = express.Router();

const {
  acceptPayment
} = require('../controllers/merchantController');

const requestSignerVerify = require('../middleware/requestSignerVerify');

router.post(
  '/merchant/v1/pay',
  requestSignerVerify,
  acceptPayment
);

module.exports = router;