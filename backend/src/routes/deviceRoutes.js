const express = require('express');
const router = express.Router();

const {
  provisionDevice,
  verifyDeviceCertificate
} = require('../controllers/deviceController');

// ----------------------------------
// DEVICE REGISTRATION
// ----------------------------------
router.post('/device/register', provisionDevice);

// ----------------------------------
// VERIFY CERTIFICATE
// ----------------------------------
router.post('/device/verify', verifyDeviceCertificate);

module.exports = router;
