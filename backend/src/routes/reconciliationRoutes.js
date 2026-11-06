const express = require('express');
const router = express.Router();

const {
  getReconReports
} = require('../controllers/reconciliationController');

const institutionAuth =
require('../middleware/institutionAuth');

router.get(
  '/rail/v1/reconciliation/reports',
  institutionAuth,
  getReconReports
);

module.exports = router;