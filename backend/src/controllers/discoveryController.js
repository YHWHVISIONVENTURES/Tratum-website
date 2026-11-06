const pool = require('../db');

// ---------------------------------------------------
// LIST DEVICES BY ISSUER
// ---------------------------------------------------
exports.getDevicesByIssuer = async (req, res) => {
  try {

    const {
      issuer_id,
      status = 'ACTIVE',
      limit = 50,
      offset = 0
    } = req.query;

    if (!issuer_id) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_ISSUER_ID'
      });
    }

    const result = await pool.query(
      `SELECT
          device_id,
          public_key,
          status,
          created_at,
          last_seen,
          ledger_count
       FROM devices
       WHERE issuer_id=$1
       AND status=$2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [
        issuer_id,
        status,
        Number(limit),
        Number(offset)
      ]
    );

    return res.json({
      ok: true,
      issuer_id,
      count: result.rows.length,
      devices: result.rows
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};

// ---------------------------------------------------
// DEVICE DETAIL VIEW (DEEP INSPECTION)
// ---------------------------------------------------
exports.getDeviceDetail = async (req, res) => {
  try {

    const { device_id } = req.params;

    const device = await pool.query(
      `SELECT *
       FROM devices
       WHERE device_id=$1
       LIMIT 1`,
      [device_id]
    );

    if (!device.rows.length) {
      return res.status(404).json({
        ok: false,
        error: 'DEVICE_NOT_FOUND'
      });
    }

    const tx = await pool.query(
      `SELECT COUNT(*)::int AS tx_count
       FROM transactions
       WHERE sender_id=$1 OR receiver_id=$1`,
      [device_id]
    );

    return res.json({
      ok: true,
      device: device.rows[0],
      stats: {
        transaction_count: tx.rows[0].tx_count
      }
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};