const pool = require('../db');
const { processInstitutionTransaction } = require('../services/bankSettlementEngine');
const { verifyFirmwareTransaction } =
  require('../services/firmwareVerifier');

exports.submitTransaction = async (req, res) => {
  try {
    const inst = req.institution;
    const tx = req.body;



    const txCheck = verifyFirmwareTransaction(
      tx,
      null
      );

    if (!txCheck.ok) {
    return res.status(400).json({
    error: 'INVALID_TX_HASH'
      });
    }
    
    const result = await processInstitutionTransaction(inst, tx);
    return res.json({
      ok: true,
      institution: inst.name,
      status: result.status
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
module.exports = {
  submitTransaction: exports.submitTransaction
};

