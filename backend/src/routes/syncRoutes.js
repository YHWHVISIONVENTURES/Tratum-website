const express = require('express');
const router = express.Router();

const test = require('../controllers/syncController');
console.log("SHARING THESE FUNCTIONS:", Object.keys(test));

// Import all functions from the syncController
const {
  receiveTransaction,
  receiveBatch,
  receiveSettlementProof,
  verifySettlementProofCA,
  verifySettlementProofLocal,
  getLedgerHash,
  getLedger,
  updateNodeState,
  receiveOfflineBatch
} = require('../controllers/syncController');

// --- Ingestion Routes ---
router.post('/api/transaction', receiveTransaction);
router.post('/api/sync', receiveBatch);

// --- Settlement & Proof Routes ---
router.post('/api/settlement/proof', receiveSettlementProof);
router.post('/api/settlement/verify/ca', verifySettlementProofCA);
router.post('/api/settlement/verify/local', verifySettlementProofLocal);

// --- Ledger Query Routes ---
router.get('/ledger/hash/:deviceId', getLedgerHash);
router.get('/ledger/:deviceId', getLedger);

// --- Node Management ---
router.post('/node/state', updateNodeState);

router.post('/api/offline/batch', receiveOfflineBatch);

module.exports = router;
