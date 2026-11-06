const pool = require('../db');

// ---------------------------------------------------
// RUN NIGHT RECON
// ---------------------------------------------------
async function runReconciliation() {

  // -----------------------------------
  // CBDC EVENT SUPPLY
  // -----------------------------------
  const cbdc = await pool.query(
    `SELECT
       COALESCE(SUM(
         CASE
           WHEN event_type='MINT' THEN amount
           WHEN event_type='BURN' THEN -amount
           ELSE 0
         END
       ),0) AS net_supply
     FROM sovereign_events`
  );

  const cbdcNet =
    Number(cbdc.rows[0].net_supply || 0);

  // -----------------------------------
  // DECLARED SUPPLY
  // -----------------------------------
  const declared = await pool.query(
    `SELECT
       COALESCE(SUM(total_issued),0) AS declared
     FROM sovereign_supply`
  );

  const declaredSupply =
    Number(declared.rows[0].declared || 0);

  // -----------------------------------
  // FIAT FLOAT
  // -----------------------------------
  const fiat = await pool.query(
    `SELECT
       COALESCE(SUM(
         CASE
           WHEN event_type='INJECT' THEN amount
           WHEN event_type='REDEEM' THEN -amount
           ELSE 0
         END
       ),0) AS net_float
     FROM fiat_events`
  );

  const fiatFloat =
    Number(fiat.rows[0].net_float || 0);

  // -----------------------------------
  // FAILED RAIL OPS
  // -----------------------------------
  const rail = await pool.query(
    `SELECT COUNT(*)::int AS failed
     FROM rail_transactions
     WHERE status='FAILED'`
  );

  const failedRail =
    rail.rows[0].failed;

  // -----------------------------------
  // UNSETTLED BANK WINDOWS
  // -----------------------------------
  const settle = await pool.query(
    `SELECT COUNT(*)::int AS pending
     FROM bank_settlements
     WHERE status!='SENT'`
  );

  const unsettled =
    settle.rows[0].pending;

  // -----------------------------------
  // LEDGER SIZE
  // -----------------------------------
  const ledger = await pool.query(
    `SELECT COUNT(*)::int AS tx_count
     FROM transactions`
  );

  const txCount =
    ledger.rows[0].tx_count;

  // -----------------------------------
  // PASS / FAIL
  // -----------------------------------
  const passed =
    cbdcNet === declaredSupply &&
    failedRail === 0 &&
    unsettled === 0;

  const notes = passed
    ? 'SYSTEM_BALANCED'
    : 'REQUIRES_REVIEW';

  // -----------------------------------
  // WRITE REPORT
  // -----------------------------------
  await pool.query(
    `INSERT INTO reconciliation_reports
     (
      report_date,
      cbdc_net_supply,
      declared_supply,
      fiat_net_float,
      unsettled_settlements,
      failed_rail_ops,
      ledger_tx_count,
      passed,
      notes
     )
     VALUES
     (
      CURRENT_DATE,
      $1,$2,$3,$4,$5,$6,$7,$8
     )`,
    [
      cbdcNet,
      declaredSupply,
      fiatFloat,
      unsettled,
      failedRail,
      txCount,
      passed,
      notes
    ]
  );

  return {
    passed,
    notes
  };
}

module.exports = {
  runReconciliation
};