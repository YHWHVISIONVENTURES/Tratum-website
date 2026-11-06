const crypto = require('crypto');
const pool = require('../db');

// ----------------------------------------
// HELPERS
// ----------------------------------------
function sha256(data) {
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex');
}

function buildReference() {
  return 'FIAT-' + Date.now();
}

// ----------------------------------------
// POST /rail/v1/fiat/inject
// Treasury / Bank injects fiat value
// ----------------------------------------
exports.injectFiat = async (req, res) => {
  try {

    const {
      institution_id,
      currency_code,
      amount,
      destination_device_id,
      source_account,
      operator_id
    } = req.body;

    if (!institution_id)
      return res.status(400).json({ ok:false, error:'INSTITUTION_REQUIRED' });

    if (!currency_code)
      return res.status(400).json({ ok:false, error:'CURRENCY_REQUIRED' });

    if (!destination_device_id)
      return res.status(400).json({ ok:false, error:'DESTINATION_REQUIRED' });

    const injectAmount = Number(amount);

    if (Number.isNaN(injectAmount) || injectAmount <= 0)
      return res.status(400).json({ ok:false, error:'INVALID_AMOUNT' });

    // --------------------------------
    // DEVICE CHECK
    // --------------------------------
    const device = await pool.query(
      `SELECT device_id
       FROM devices
       WHERE device_id=$1
       LIMIT 1`,
      [destination_device_id]
    );

    if (!device.rows.length) {
      return res.status(404).json({
        ok:false,
        error:'DEVICE_NOT_FOUND'
      });
    }

    const reference = buildReference();

    const payload = {
      institution_id,
      currency_code,
      amount: injectAmount,
      destination_device_id,
      source_account: source_account || null,
      operator_id: operator_id || null,
      reference,
      ts: Date.now()
    };

    const tx_hash =
      sha256(JSON.stringify(payload));

    // --------------------------------
    // LEDGER RECORD
    // --------------------------------
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
        institution_id,
        destination_device_id,
        injectAmount,
        Date.now(),
        Date.now(),
        JSON.stringify(payload)
      ]
    );

    // --------------------------------
    // FLOAT TABLE
    // --------------------------------
    await pool.query(
      `INSERT INTO fiat_float
       (
         institution_id,
         currency_code,
         total_injected,
         updated_at
       )
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (institution_id, currency_code)
       DO UPDATE SET
         total_injected =
         fiat_float.total_injected + $3,
         updated_at = NOW()`,
      [
        institution_id,
        currency_code,
        injectAmount
      ]
    );

    // --------------------------------
    // EVENT LOG
    // --------------------------------
    await pool.query(
      `INSERT INTO fiat_events
       (
         event_type,
         institution_id,
         currency_code,
         amount,
         destination_device_id,
         reference,
         created_at
       )
       VALUES
       ('INJECT',$1,$2,$3,$4,$5,NOW())`,
      [
        institution_id,
        currency_code,
        injectAmount,
        destination_device_id,
        reference
      ]
    );

    return res.json({
      ok:true,
      action:'FIAT_INJECTED',
      reference,
      tx_hash
    });

  } catch (err) {

    return res.status(500).json({
      ok:false,
      error:err.message
    });

  }
};

// ----------------------------------------
// GET FLOAT STATUS
// GET /rail/v1/fiat/float/:institution/:currency
// ----------------------------------------
exports.getFloat = async (req, res) => {
  try {

    const {
      institution,
      currency
    } = req.params;

    const result = await pool.query(
      `SELECT *
       FROM fiat_float
       WHERE institution_id=$1
       AND currency_code=$2
       LIMIT 1`,
      [institution, currency]
    );

    return res.json({
      ok:true,
      data: result.rows[0] || null
    });

  } catch (err) {

    return res.status(500).json({
      ok:false,
      error:err.message
    });

  }
};