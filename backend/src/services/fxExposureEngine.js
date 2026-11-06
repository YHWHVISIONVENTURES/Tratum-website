const pool = require('../db');

async function computeFXExposure() {

  const result = await pool.query(
    `
    SELECT
    country_code,
      currency_code,

      SUM(
        CASE
          WHEN direction='CREDIT'
          THEN amount
          ELSE -amount
        END
      ) AS reserves

    FROM treasury_ledger
    GROUP BY country_code, currency_code
    `
  );

  for (const row of result.rows) {

    const locks =
      await pool.query(
        `
        SELECT
          COALESCE(
            SUM(amount),
            0
          ) AS locked
        FROM treasury_liquidity_locks
        WHERE source_currency=$1
        AND country_code=$2
        AND status='LOCKED'
        `,
        [row.currency_code, row.country_code]
      );

    const gross_exposure = Number(row.reserves || 0);
    const locked_exposure = Number(locks.rows[0].exposure || 0);
    const net_exposure = gross_exposure - locked_exposure;

    await pool.query(
      `
      INSERT INTO fx_exposure
      (
        country_code,
        currency_code,
        total_reserves,
        locked_reserves,
        net_exposure,
        exposure_status,
        captured_at
      )
      VALUES ($1,$2,$3,$4,$5, NOW())
      `,
      [
        row.country_code,
        row.currency_code,
        gross_exposure,
        locked_exposure,
        net_exposure,
        net_exposure < 0
          ? 'CRITICAL'
          : net_exposure < reserve * 0.2
            ? 'WARNING'
            : 'HEALTHY'
      ]
    );
  }
}

module.exports = {
  computeFXExposure
};