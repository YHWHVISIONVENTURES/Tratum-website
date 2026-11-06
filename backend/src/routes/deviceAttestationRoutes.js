const express = require('express');
const router = express.Router();

const {
  initAttestation,
  completeAttestation
} = require('../controllers/deviceAttestationController');

// ----------------------------------
// DEVICE ATTESTATION (DEVICE → CORE)
// ----------------------------------

// Step 1: Request challenge
router.post('/device/v1/attestation/init', initAttestation);

// Step 2: Submit signed response
router.post('/device/v1/attestation/complete', completeAttestation);

module.exports = router;