// ==========================================================
// FILE: /services/complianceEngine.js
// TRATUM — REGULATOR + AML + REPORTING ENGINE
// ==========================================================

const crypto = require('crypto');
const pool = require('../db');

const {
  resolveKycRules
} = require('./countryResolutionEngine');

// ----------------------------------------------------------
// HELPERS
// ----------------------------------------------------------
function buildReportId(
  type,
  period
) {

  return crypto
    .createHash('sha256')
    .update(`${type}|${period}`)
    .digest('hex');
}

// ----------------------------------------------------------
// VAT REPORT
// ----------------------------------------------------------
async function generateVATReport(
  period
) {

  const result = await pool.query(
    `
    SELECT
      institution_id,
      SUM(tax_amount)::numeric(20,2)
        AS vat_total,
      COUNT(*)::int
        AS tx_count
    FROM tax_transactions
    WHERE tax_type='VAT'
    AND TO_CHAR(
      created_at,
      'YYYY-MM'
    ) = $1
    GROUP BY institution_id
    ORDER BY vat_total DESC
    `,
    [period]
  );

  const reportId =
    buildReportId(
      'VAT',
      period
    );

  await pool.query(
    `
    INSERT INTO regulator_reports
    (
      report_id,
      report_type,
      jurisdiction,
      report_period,
      report_payload,
      status
    )
    VALUES
    (
      $1,
      'VAT_REPORT',
      'NG',
      $2,
      $3,
      'GENERATED'
    )
    ON CONFLICT (report_id)
    DO NOTHING
    `,
    [
      reportId,
      period,
      JSON.stringify(result.rows)
    ]
  );

  return {
    report_id: reportId,
    rows: result.rows
  };
}

// ----------------------------------------------------------
// AML SPIKE DETECTION
// ----------------------------------------------------------
async function detectAMLSpikes() {

  const result = await pool.query(
    `
    SELECT
      sender_id,
      COUNT(*)::int AS tx_count,
      SUM(amount)::numeric(20,2)
        AS total_volume
    FROM transactions
    WHERE created_at >=
      NOW() - INTERVAL '24 hours'
    GROUP BY sender_id
    HAVING
      COUNT(*) >= 100
      OR
      SUM(amount) >= 5000000
    ORDER BY total_volume DESC
    `
  );

  for (const row of result.rows) {

    await pool.query(
      `
      INSERT INTO fraud_alerts
      (
        severity,
        actor_id,
        alert_code,
        details,
        resolved
      )
      VALUES
      (
        'HIGH',
        $1,
        'AML_SPIKE',
        $2,
        false
      )
      `,
      [
        row.sender_id,
        JSON.stringify(row)
      ]
    );

    await pool.query(
      `
      INSERT INTO audit_log
      (actor, action, payload)
      VALUES ($1,$2,$3)
      `,
      [
        row.sender_id,
        'AML_SPIKE_DETECTED',
        JSON.stringify(row)
      ]
    );
  }

  return {
    alerts: result.rows.length
  };
}

// ----------------------------------------------------------
// FAILED SETTLEMENT REPORT
// ----------------------------------------------------------
async function generateSettlementFailureReport() {

  const result = await pool.query(
    `
    SELECT
      institution_id,
      COUNT(*)::int AS failures,
      SUM(amount)::numeric(20,2)
        AS total_failed
    FROM settlement_bridge
    WHERE status='FAILED'
    GROUP BY institution_id
    ORDER BY total_failed DESC
    `
  );

  return result.rows;
}

// ----------------------------------------------------------
// REGULATOR EXPORT
// ----------------------------------------------------------
async function exportRegulatorStatement(
  period
) {

  const [
    vat,
    failed
  ] = await Promise.all([

    generateVATReport(period),

    generateSettlementFailureReport()
  ]);

  const statement = {

    jurisdiction: 'NG',

    reporting_period: period,

    generated_at:
      new Date().toISOString(),

    vat_report:
      vat.rows,

    failed_settlements:
      failed
  };

  const reportId =
    buildReportId(
      'REGULATOR_STATEMENT',
      period
    );

  await pool.query(
    `
    INSERT INTO regulator_reports
    (
      report_id,
      report_type,
      jurisdiction,
      report_period,
      report_payload,
      status
    )
    VALUES
    (
      $1,
      'REGULATOR_STATEMENT',
      'NG',
      $2,
      $3,
      'GENERATED'
    )
    ON CONFLICT (report_id)
    DO NOTHING
    `,
    [
      reportId,
      period,
      JSON.stringify(statement)
    ]
  );

  return {
    report_id: reportId,
    statement
  };
}
// ==========================================================
// COUNTRY KYC VALIDATION
// ==========================================================
async function validateCountryKyc({

  country_code,
  tier_name,
  amount

}) {

  const rules =
    await resolveKycRules({

      country_code,
      tier_name

    });

  if (
    Number(amount) >
    Number(rules.daily_limit)
  ) {
    throw new Error(
      'KYC_DAILY_LIMIT_EXCEEDED'
    );
  }

  return {
    status: 'APPROVED',
    rules
  };
}


module.exports = {

  applyAMLDetection:
    detectAMLSpikes,

  generateVATReport,

  exportRegulatorStatement,

  generateSettlementFailureReport,
  validateCountryKyc
};