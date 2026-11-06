const crypto = require('crypto');
const pool = require('../db');

function sha256(data) {
  return crypto.createHash('sha256')
    .update(data)
    .digest('hex');
}

function ref() {
  return `IB-${Date.now()}`;
}

// ---------------------------------------------------
// CREATE INTERBANK SETTLEMENT
// ---------------------------------------------------
exports.createSettlement = async (req, res) => {
  try {

    const {
      from_bank,
      to_bank,
      currency_code = 'NGN',
      amount,
      reason
    } = req.body;

    if (!from_bank || !to_bank) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_BANK_PARTIES'
      });
    }

    const value = Number(amount);

    if (Number.isNaN(value) || value <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_AMOUNT'
      });
    }

    const settlement_id = ref();

    const payload = {
      from_bank,
      to_bank,
      currency_code,
      amount: value,
      reason,
      settlement_id,
      ts: Date.now()
    };

    const tx_hash =
      sha256(JSON.stringify(payload));

    await pool.query(
      `INSERT INTO interbank_settlements
       (
        settlement_id,
        from_bank,
        to_bank,
        currency_code,
        amount,
        reason,
        tx_hash
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        settlement_id,
        from_bank,
        to_bank,
        currency_code,
        value,
        reason || null,
        tx_hash
      ]
    );

    return res.json({
      ok: true,
      settlement_id,
      tx_hash,
      status: 'PENDING'
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};

// ---------------------------------------------------
// GET HISTORY
// ---------------------------------------------------
exports.getSettlements = async (req, res) => {
  try {

    const result = await pool.query(
      `SELECT *
       FROM interbank_settlements
       ORDER BY created_at DESC
       LIMIT 100`
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