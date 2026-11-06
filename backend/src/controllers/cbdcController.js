const crypto = require('crypto');
const pool = require('../db');

// --------------------------------------------------
// HELPERS
// --------------------------------------------------
function sha256(data) {
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex');
}

function buildRef() {
  return 'CBDC-' + Date.now();
}

// --------------------------------------------------
// MINT CBDC
// POST /cbdc/v1/mint
// --------------------------------------------------
exports.mintCBDC = async (req, res) => {
  try {

    const {
      sovereign_id,
      currency_code,
      amount,
      destination_device_id,
      operator_id
    } = req.body;

    if (!sovereign_id)
      return res.status(400).json({ ok:false, error:'SOVEREIGN_ID_REQUIRED' });

    if (!currency_code)
      return res.status(400).json({ ok:false, error:'CURRENCY_CODE_REQUIRED' });

    if (!destination_device_id)
      return res.status(400).json({ ok:false, error:'DESTINATION_REQUIRED' });

    const mintAmount = Number(amount);

    if (Number.isNaN(mintAmount) || mintAmount <= 0)
      return res.status(400).json({ ok:false, error:'INVALID_AMOUNT' });

    // ------------------------------------
    // VERIFY DEVICE EXISTS
    // ------------------------------------
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

    const reference = buildRef();

    const payload = {
      sovereign_id,
      currency_code,
      amount: mintAmount,
      destination_device_id,
      operator_id: operator_id || null,
      reference,
      ts: Date.now()
    };

    const tx_hash =
      sha256(JSON.stringify(payload));

    // ------------------------------------
    // INSERT LEDGER TX
    // ------------------------------------
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
        destination_device_id,
        mintAmount,
        Date.now(),
        Date.now(),
        JSON.stringify(payload)
      ]
    );

    // ------------------------------------
    // UPDATE SUPPLY
    // ------------------------------------
    await pool.query(
      `INSERT INTO cbdc_supply
       (
         sovereign_id,
         currency_code,
         total_supply,
         updated_at
       )
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (sovereign_id, currency_code)
       DO UPDATE SET
         total_supply =
         cbdc_supply.total_supply + $3,
         updated_at = NOW()`,
      [
        sovereign_id,
        currency_code,
        mintAmount
      ]
    );

    // ------------------------------------
    // AUDIT LOG
    // ------------------------------------
    await pool.query(
      `INSERT INTO cbdc_events
       (
         event_type,
         sovereign_id,
         currency_code,
         amount,
         reference,
         created_at
       )
       VALUES
       ('MINT',$1,$2,$3,$4,NOW())`,
      [
        sovereign_id,
        currency_code,
        mintAmount,
        reference
      ]
    );

    return res.json({
      ok:true,
      action:'MINTED',
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

// --------------------------------------------------
// SUPPLY STATUS
// GET /cbdc/v1/supply/:sovereign/:currency
// --------------------------------------------------
exports.getSupply = async (req, res) => {
  try {

    const { sovereign, currency } = req.params;

    const result = await pool.query(
      `SELECT *
       FROM cbdc_supply
       WHERE sovereign_id=$1
       AND currency_code=$2
       LIMIT 1`,
      [sovereign, currency]
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