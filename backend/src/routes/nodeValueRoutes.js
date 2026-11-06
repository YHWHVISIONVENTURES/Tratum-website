const express = require('express');
const router = express.Router();

const adminAuth = require('../middleware/adminAuth');
// 1. ADD THIS: Import the limiter from your middleware folder
const  nodeFundingLimiter  = require('../middleware/nodeFundingLimiter');

const ctrl = require('../controllers/nodeValueController');

// 2. INJECT IT HERE: Add 'nodeFundingLimiter' before the controller
router.post(
  '/admin/nodes/deposit', 
  adminAuth, 
  nodeFundingLimiter, 
  ctrl.depositToNode
);

router.post(
  '/admin/nodes/redeem', 
  adminAuth, 
  nodeFundingLimiter, // Added here too for "Burn" protection
  ctrl.redeemFromNode
);

router.get('/admin/nodes/:device_id/balance', adminAuth, ctrl.getNodeBalance);

module.exports = router;
