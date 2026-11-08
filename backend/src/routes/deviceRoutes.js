const express = require('express');
const router = express.Router();

const {
  provisionDevice,
  verifyDeviceCertificate
} = require('../controllers/deviceController');

// ----------------------------------
// DEVICE REGISTRATION
// ----------------------------------
router.post('/device/register', (req,res) => res.status(410).json({ok:false,error:'USE_OPERATOR_AUTHORIZED_V2_ENROLLMENT'}));

// ----------------------------------
// VERIFY CERTIFICATE
// ----------------------------------
router.post('/device/verify', verifyDeviceCertificate);

module.exports = router;
