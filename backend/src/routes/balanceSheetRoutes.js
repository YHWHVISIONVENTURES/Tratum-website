const express = require('express');
const router = express.Router();

const {
  getBalanceSheet
} = require('../controllers/balanceSheetController');

const institutionAuth =
require('../middleware/institutionAuth');

// -------------------------------------
// BALANCE SHEET ROUTE
// -------------------------------------
router.get(
  '/rail/v1/treasury/balance-sheet',
  institutionAuth,
  getBalanceSheet
);

module.exports = router;