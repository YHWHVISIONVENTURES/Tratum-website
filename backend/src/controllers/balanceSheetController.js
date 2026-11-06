const pool = require('../db');

// ---------------------------------------------------
// GET CENTRAL BANK BALANCE SHEET
// ---------------------------------------------------
exports.getBalanceSheet = async (req, res) => {
  try {

    const result = await pool.query(
      `SELECT * FROM central_bank_balance_sheet`
    );

    return res.json({
      ok: true,
      report: result.rows[0]
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};