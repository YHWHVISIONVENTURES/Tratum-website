const {

  applyAMLDetection,

  generateVATReport,

  exportRegulatorStatement,

  generateSettlementFailureReport

} = require('../services/complianceEngine');

// ----------------------------------------------------
// AML LOOP
// ----------------------------------------------------
async function runAMLChecks() {

  try {

    const result =
      await applyAMLDetection();

    console.log(
      '[COMPLIANCE AML]',
      result
    );

  } catch (err) {

    console.error(
      '[AML FAILED]',
      err.message
    );
  }
}

// ----------------------------------------------------
// FAILED SETTLEMENT MONITOR
// ----------------------------------------------------
async function runSettlementAudit() {

  try {

    const result =
      await generateSettlementFailureReport();

    console.log(
      '[SETTLEMENT AUDIT]',
      result.length
    );

  } catch (err) {

    console.error(
      '[SETTLEMENT AUDIT FAILED]',
      err.message
    );
  }
}

// ----------------------------------------------------
// MONTHLY REGULATOR EXPORT
// ----------------------------------------------------
async function runMonthlyRegulatorExport() {

  try {

    const period =
      new Date()
      .toISOString()
      .slice(0, 7);

    await generateVATReport(period);

    await exportRegulatorStatement(
      period
    );

    console.log(
      '[REGULATOR EXPORT COMPLETE]',
      period
    );

  } catch (err) {

    console.error(
      '[REGULATOR EXPORT FAILED]',
      err.message
    );
  }
}

module.exports = {

  runAMLChecks,

  runSettlementAudit,

  runMonthlyRegulatorExport
};