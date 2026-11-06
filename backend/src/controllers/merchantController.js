const crypto = require('crypto');
const pool = require('../db');

function ref() {
  return 'MER-' + Date.now();
}

exports.acceptPayment = async (req, res) => {
  try {

    const {
      merchant_id,
      payer_device_id,
      asset_used,
      amount
    } = req.body;

    if (!merchant_id || !asset_used || !amount) {
      return res.status(400).json({
        ok: false,
        error: 'INVALID_REQUEST'
      });
    }

    const payment_ref = ref();

    await pool.query(
      `INSERT INTO merchant_settlements
       (
        payment_ref,
        merchant_id,
        payer_device_id,
        asset_used,
        amount,
        settlement_currency
       )
       VALUES ($1,$2,$3,$4,$5,'PENDING')`,
      [
        payment_ref,
        merchant_id,
        payer_device_id || null,
        asset_used,
        amount
      ]
    );

    return res.json({
      ok: true,
      payment_ref,
      status: 'ACCEPTED'
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};