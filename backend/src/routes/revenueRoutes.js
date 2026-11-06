const express = require('express');
const router = express.Router();

const c = require('../controllers/revenueController');
const institutionAuth = require('../middleware/institutionAuth');

router.get('/admin/revenue/summary', institutionAuth, c.summary);
router.get('/admin/revenue/history', institutionAuth, c.history);
router.get('/admin/revenue/by-type', institutionAuth, c.byFeeType);

module.exports = router;