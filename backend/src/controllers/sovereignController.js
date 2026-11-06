const crypto = require('crypto');
const pool = require('../db');
const { recordRevenue } = require('../services/revenueLedger'); // 1. IMPORT REVENUE LEDGER

// -------------------------------------
// HELPERS
// -------------------------------------
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function ref(prefix) {
  return prefix + '-' + Date.now();
}

// -------------------------------------
// POST /rail/v1/sovereign/mint
// Sovereign treasury issues state value
// -------------------------------------
exports.mintSovereign = async (req, res) => {
  try {
    const {
      sovereign_id,
      currency_code,
      amount,
      destination_device_id,
      treasury_operator,
      policy_tier,
      memo
    } = req.body;

    if (!sovereign_id || !currency_code || !destination_device_id)
      return res.status(400).json({ ok: false, error: 'MISSING_REQUIRED_FIELDS' });

    const mintAmount = Number(amount);
    if (Number.isNaN(mintAmount) || mintAmount <= 0)
      return res.status(400).json({ ok: false, error: 'INVALID_AMOUNT' });

    // -------------------------------
    // device exists
    // -------------------------------
    const device = await pool.query(
      `SELECT device_id FROM devices WHERE device_id=$1 LIMIT 1`,
      [destination_device_id]
    );

    if (!device.rows.length)
      return res.status(404).json({ ok: false, error: 'DEVICE_NOT_FOUND' });

    // 2. FEE CALCULATION
    const { bundle } = require('../services/feeEngine');
    const fees = await bundle(['SOVEREIGN_MINT'], mintAmount);

    const reference = ref('SOV-MINT');

    const payload = {
      sovereign_id,
      currency_code,
      amount: mintAmount,
      destination_device_id,
      treasury_operator: treasury_operator || null,
      policy_tier: policy_tier || 'STANDARD',
      memo: memo || null,
      reference,
      fee_charged: fees.total_fee,
      ts: Date.now()
    };

    const tx_hash = sha256(JSON.stringify(payload));

    // 3. LEDGER & SUPPLY UPDATES
    await pool.query(
      `INSERT INTO transactions 
       (tx_hash, sender_id, receiver_id, amount, timestamp, nonce, status, synced, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,1,true,$7)`,
      [tx_hash, sovereign_id, destination_device_id, mintAmount, Date.now(), Date.now(), JSON.stringify(payload)]
    );

    await pool.query(
      `INSERT INTO sovereign_supply (sovereign_id, currency_code, total_issued, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (sovereign_id, currency_code)
       DO UPDATE SET total_issued = sovereign_supply.total_issued + $3, updated_at = NOW()`,
      [sovereign_id, currency_code, mintAmount]
    );

    await pool.query(
      `INSERT INTO sovereign_events (event_type, sovereign_id, currency_code, amount, destination_device_id, reference, created_at)
       VALUES ('MINT',$1,$2,$3,$4,$5,NOW())`,
      [sovereign_id, currency_code, mintAmount, destination_device_id, reference]
    );

    // 4. REPLACE SYSTEM_TREASURY WITH REVENUE_LEDGER (WATERFALL SPLIT)
    await recordRevenue({
      source_type: 'SOVEREIGN_RAIL',
      source_ref: reference,
      fee_type: 'SOVEREIGN_ISSUANCE_FEE',
      amount: fees.total_fee,
      currency_code: currency_code,
      metadata: { 
        operator: treasury_operator,
        policy: policy_tier,
        fee_breakdown: fees 
      }
    });

    return res.json({
      ok: true,
      action: 'SOVEREIGN_MINTED',
      reference,
      tx_hash,
      fee_collected: fees.total_fee
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};

// -------------------------------------
// GET SUPPLY
// -------------------------------------
exports.getSupply = async (req, res) => {
  try {
    const { sovereign, currency } = req.params;
    const result = await pool.query(
      `SELECT * FROM sovereign_supply WHERE sovereign_id=$1 AND currency_code=$2 LIMIT 1`,
      [sovereign, currency]
    );
    return res.json({ ok: true, data: result.rows[0] || null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
