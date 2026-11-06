const pool = require('../db');

exports.getReconReports =
async (req, res) => {
  try {

    const result = await pool.query(
      `SELECT *
       FROM reconciliation_reports
       ORDER BY created_at DESC
       LIMIT 30`
    );

    res.json({
      ok: true,
      reports: result.rows
    });

  } catch (err) {

    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};