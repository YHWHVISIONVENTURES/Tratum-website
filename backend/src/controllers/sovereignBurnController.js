const crypto = require('crypto');
const pool = require('../db');

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function ref(prefix) {
  return `${prefix}-${Date.now()}`;
}

// ---------------------------------------------------
// POST /rail/v1/sovereign/burn
// Treasury destroys / redeems sovereign currency
// ---------------------------------------------------
exports.burnSovereign = async (req, res) => {
  try {

    const {
      sovereign_id,
      currency_code,
      amount,
      source_device_id,
      treasury_operator,
      reason
    } = req.body;

    // -----------------------------
    // VALIDATION
    // -----------------------------
    if (!sovereign_id || !currency_code) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_SOVEREIGN_CONTEXT'
      });
    }

    const burnAmount = Number(amount);

    if (Number.isNaN(burnAmount) || burnAmount <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_BURN_AMOUNT'
      });
    }

    // -----------------------------
    // CHECK SUPPLY EXISTS
    // -----------------------------
    const supply = await pool.query(
      `SELECT total_issued
       FROM sovereign_supply
       WHERE sovereign_id=$1
       AND currency_code=$2
       LIMIT 1`,
      [sovereign_id, currency_code]
    );

    if (!supply.rows.length) {
      return res.status(404).json({
        ok: false,
        error: 'SOVEREIGN_SUPPLY_NOT_FOUND'
      });
    }

    const current = Number(supply.rows[0].total_issued);

    if (burnAmount > current) {
      return res.status(400).json({
        ok: false,
        error: 'BURN_EXCEEDS_SUPPLY'
      });
    }

    const reference = ref('SOV-BURN');

    const payload = {
      sovereign_id,
      currency_code,
      amount: burnAmount,
      source_device_id: source_device_id || null,
      treasury_operator: treasury_operator || null,
      reason: reason || null,
      reference,
      ts: Date.now()
    };

    const tx_hash = sha256(JSON.stringify(payload));

    // -----------------------------
    // INSERT LEDGER ENTRY
    // -----------------------------
    await pool.query(
      `INSERT INTO transactions
       (
        tx_hash,
        sender_id,
        receiver_id,
        amount,
        timestamp,
        nonce,
        status,
        synced,
        raw_payload
       )
       VALUES
       ($1,$2,$3,$4,$5,$6,1,true,$7)
       ON CONFLICT (tx_hash)
       DO NOTHING`,
      [
        tx_hash,
        sovereign_id,
        'BURN_ENGINE',
        burnAmount,
        Date.now(),
        Date.now(),
        JSON.stringify(payload)
      ]
    );

    // -----------------------------
    // UPDATE SUPPLY (DESTRUCTION)
    // -----------------------------
    await pool.query(
      `UPDATE sovereign_supply
       SET total_issued = total_issued - $1,
           updated_at = NOW()
       WHERE sovereign_id=$2
       AND currency_code=$3`,
      [burnAmount, sovereign_id, currency_code]
    );

    // -----------------------------
    // EVENT LOG
    // -----------------------------
    await pool.query(
      `INSERT INTO sovereign_events
       (
        event_type,
        sovereign_id,
        currency_code,
        amount,
        source_device_id,
        reference,
        created_at
       )
       VALUES
       ('BURN',$1,$2,$3,$4,$5,NOW())`,
      [
        sovereign_id,
        currency_code,
        burnAmount,
        source_device_id,
        reference
      ]
    );

    return res.json({
      ok: true,
      action: 'SOVEREIGN_BURNED',
      reference,
      tx_hash,
      burned: burnAmount
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};

// ---------------------------------------------------
// GET BURN HISTORY
// ---------------------------------------------------
exports.getBurnHistory = async (req, res) => {
  try {

    const { sovereign, currency } = req.params;

    const result = await pool.query(
      `SELECT *
       FROM sovereign_events
       WHERE sovereign_id=$1
       AND currency_code=$2
       AND event_type='BURN'
       ORDER BY created_at DESC`,
      [sovereign, currency]
    );

    return res.json({
      ok: true,
      data: result.rows
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};