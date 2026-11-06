const pool = require('../db');

// ---------------------------------------------------
// GET ALL SOVEREIGN EVENTS (MINT + BURN)
// ---------------------------------------------------
exports.getSovereignAudit = async (req, res) => {
  try {

    const {
      sovereign_id,
      currency_code,
      limit = 50,
      offset = 0
    } = req.query;

    if (!sovereign_id || !currency_code) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_AUDIT_SCOPE'
      });
    }

    const result = await pool.query(
      `SELECT
          event_type,
          sovereign_id,
          currency_code,
          amount,
          reference,
          created_at,
          source_device_id
       FROM sovereign_events
       WHERE sovereign_id = $1
       AND currency_code = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [
        sovereign_id,
        currency_code,
        Number(limit),
        Number(offset)
      ]
    );

    return res.json({
      ok: true,
      scope: {
        sovereign_id,
        currency_code
      },
      count: result.rows.length,
      data: result.rows
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};

// ---------------------------------------------------
// GET SUPPLY SNAPSHOT (LIVE STATE)
// ---------------------------------------------------
exports.getSupplySnapshot = async (req, res) => {
  try {

    const {
      sovereign_id,
      currency_code
    } = req.query;

    const result = await pool.query(
      `SELECT total_issued
       FROM sovereign_supply
       WHERE sovereign_id=$1
       AND currency_code=$2
       LIMIT 1`,
      [sovereign_id, currency_code]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        ok: false,
        error: 'SOVEREIGN_NOT_FOUND'
      });
    }

    return res.json({
      ok: true,
      sovereign_id,
      currency_code,
      total_supply: result.rows[0].total_issued
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};

// ---------------------------------------------------
// GET LAST N EVENTS (FAST DASHBOARD FEED)
// ---------------------------------------------------
exports.getRecentEvents = async (req, res) => {
  try {

    const {
      limit = 10
    } = req.query;

    const result = await pool.query(
      `SELECT *
       FROM sovereign_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [Number(limit)]
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