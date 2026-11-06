const pool = require('../db');

async function resolveTreasuryPool({

  country,
  currency_code

}) {

  const result =
    await pool.query(
      `
      SELECT *
      FROM sovereign_treasury_pools
      WHERE country_code=$1
      AND currency_code=$2
      AND active=true
      LIMIT 1
      `,
      [
        country,
        currency_code
      ]
    );

  return result.rows[0] || null;
}

module.exports = {
  resolveTreasuryPool
};