const express = require('express');
const router = express.Router();
const { ingestP2PTransaction } = require('../services/p2pIngestionEngine');

// 🛡️ SECURITY GATE: Only allow signed requests from known Institutions
const requestSignerVerify = require('../middleware/requestSignerVerify');

router.post('/submit', requestSignerVerify, async (req, res) => {
  try {
    // req.body now contains the verified issuer_id from the signature
    const result = await ingestP2PTransaction(req.body);

    res.json({
      ok: true,
      ...result
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

module.exports = router;
