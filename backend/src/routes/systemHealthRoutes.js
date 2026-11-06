const express = require('express');
const router = express.Router();

const {
  getSystemHealth
} = require('../controllers/systemHealthController');

const institutionAuth =
require('../middleware/institutionAuth');

// -------------------------------------
// SYSTEM HEALTH API
// -------------------------------------
router.get(
  '/rail/v1/system/health',
  institutionAuth,
  getSystemHealth
);

module.exports = router;