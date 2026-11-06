const express = require('express');
const router = express.Router();

const {
  getDevicesByIssuer,
  getDeviceDetail
} = require('../controllers/discoveryController');

const institutionAuth =
require('../middleware/institutionAuth');

// -------------------------------------
// ISSUER DEVICE DISCOVERY
// -------------------------------------
router.get(
  '/rail/v1/discovery/devices',
  institutionAuth,
  getDevicesByIssuer
);

// -------------------------------------
// DEVICE INSPECTION
// -------------------------------------
router.get(
  '/rail/v1/discovery/device/:device_id',
  institutionAuth,
  getDeviceDetail
);

module.exports = router;