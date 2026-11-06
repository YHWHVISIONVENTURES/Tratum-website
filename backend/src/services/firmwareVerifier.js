const {
  computeFirmwareTxHash,
  computeSettlementProofHash
} = require('../utils/firmwareCodec');

// =====================================================
// VERIFY TX HASH
// =====================================================
function verifyFirmwareTransaction(tx, sessionTokenHex) {

  const rebuilt =
    computeFirmwareTxHash(tx, sessionTokenHex);

  return {
    ok: rebuilt === tx.tx_hash,
    rebuilt
  };
}

// =====================================================
// VERIFY SETTLEMENT PROOF
// =====================================================
function verifySettlementProof(proof) {

  const rebuilt =
    computeSettlementProofHash(proof);

  return {
    ok: rebuilt === proof.proof_hash,
    rebuilt
  };
}

module.exports = {
  verifyFirmwareTransaction,
  verifySettlementProof
};