const crypto = require('crypto');
const pool = require('../db');

// -------------------------------------
// HASH UTILITY
// -------------------------------------
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// -------------------------------------
// POST /rail/v1/execute
// SINGLE UNIFIED RAIL ENTRY POINT
// -------------------------------------
exports.executeRail = async (req, res) => {
  try {

    const {
      actor_id,
      actor_type,     // BANK | MFI | CBDC | TREASURY
      operation,      // MINT | BURN | TRANSFER | SETTLE
      payload
    } = req.body;

    // -----------------------------
    // VALIDATION
    // -----------------------------
    if (!actor_id || !actor_type || !operation) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_RAIL_REQUEST'
      });
    }

    if (!payload) {
      const allowedOps = [
  'MINT',
  'BURN',
  'TRANSFER',
  'SETTLE',

  'STABLE_LOAD',
  'STABLE_SPEND',
  'STABLE_REDEEM'
];

if (!allowedOps.includes(operation)) {
  return res.status(400).json({
    ok: false,
    error: 'INVALID_OPERATION'
  });
}
      return res.status(400).json({
        ok: false,
        error: 'MISSING_PAYLOAD'
      });
    }

    const reference = `RAIL-${Date.now()}`;

    const canonical = {
      actor_id,
      actor_type,
      operation,
      payload,
      reference,
      ts: Date.now()
    };

    const tx_hash = sha256(JSON.stringify(canonical));

    // -----------------------------
    // WRITE TO RAIL LEDGER (GATEWAY LAYER)
    // -----------------------------
    await pool.query(
      `INSERT INTO rail_transactions
       (
        tx_hash,
        actor_id,
        actor_type,
        operation,
        payload,
        reference,
        timestamp
       )
       VALUES
       ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tx_hash) DO NOTHING`,
      [
        tx_hash,
        actor_id,
        actor_type,
        operation,
        JSON.stringify(payload),
        reference,
        Date.now()
      ]
    );

    return res.json({
      ok: true,
      status: 'RAIL_ACCEPTED',
      reference,
      tx_hash
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};

exports.railDepositToNode = async (req, res) => {
  try {
    const {
      device_id,
      amount,
      bank_ref,
      signature
    } = req.body;

    // 1. Signature verification
    const valid = verifyRailSignature(req.body, signature);
    if (!valid) {
      return res.status(401).json({
        ok:false,
        error:'INVALID_SIGNATURE'
      });
    }

    // 2. Forward to node funding (internal call)
    req.body.source_ref = bank_ref;

    return require('./nodeValueController')
      .depositToNode(req,res);

  } catch(err){
    res.status(500).json({ ok:false, error:err.message });
  }
};