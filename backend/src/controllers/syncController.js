const pool = require('../db');

const {
  cryptoVerify,
  verifyProofHash
} = require('../utils/cryptoVerify');
const { verifyFirmwareTransaction } =
  require('../services/firmwareVerifier');
  

// TRUST ANCHOR (CA ROOT KEY)
// loaded once at module initialization
const TRUST_CA_PUBLIC_KEY = process.env.TRUST_CA_PUBLIC_KEY;

if (!TRUST_CA_PUBLIC_KEY) {
  console.warn('[SECURITY] TRUST_CA_PUBLIC_KEY is not configured');
}


// =====================================================
// RECEIVE SINGLE TRANSACTION (CANONICAL LEDGER GATE)
// =====================================================
exports.receiveTransaction = async (req, res) => {
  try {
    const tx = req.body;

    // ================================
    // CANONICAL LEDGER LAYER
    // ================================
    if (!tx || !tx.tx_hash) {
      return res.status(400).json({ code: 0, error: "INVALID_TX_OBJECT" });
    }

    const canonicalTx = {
      tx_hash: String(tx.tx_hash),
      senderID: String(tx.senderID),
      receiverID: String(tx.receiverID),
      amount: Number(tx.amount),
      timestamp: Number(tx.timestamp),
      nonce: Number(tx.nonce),
    };

        // -----------------------------
    // VALIDATION GATES
    // -----------------------------
    if (
      !canonicalTx.tx_hash ||
      !canonicalTx.senderID ||
      !canonicalTx.receiverID
    ) {
      return res.status(400).json({ code: 0, error: "MISSING_FIELDS" });
    }

    if (Number.isNaN(canonicalTx.amount) || canonicalTx.amount <= 0) {
      return res.status(400).json({ code: 0, error: "INVALID_AMOUNT" });
    }

    if (Number.isNaN(canonicalTx.timestamp)) {
      return res.status(400).json({ code: 0, error: "INVALID_TIMESTAMP" });
    }

    // -----------------------------
    // REPLAY PROTECTION (MOVE UP)
    // -----------------------------
    const exists = await pool.query(
      `SELECT 1 FROM transactions WHERE tx_hash=$1 LIMIT 1`,
      [canonicalTx.tx_hash]
    );

    if (exists.rows.length > 0) {
      return res.json({ code: 1, status: "DUPLICATE_IGNORED" });
    }

    // -----------------------------
    // CRYPTO VERIFICATION (FIRMWARE TRUTH GATE)
    // -----------------------------

    const txCheck = verifyFirmwareTransaction(
      canonicalTx,
      tx.session_token || ''
    );

    if (!txCheck.ok) {
      return res.status(400).json({
        code: 0,
        error: 'INVALID_TX_HASH'
      });
    }

    // -----------------------------
    // INSERT INTO LEDGER
    // -----------------------------
    await pool.query(
      `INSERT INTO transactions
      (tx_hash, sender_id, receiver_id, amount, timestamp, nonce, status, synced, raw_payload)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)
      ON CONFLICT (tx_hash) DO NOTHING`,
      [
        canonicalTx.tx_hash,
        canonicalTx.senderID,
        canonicalTx.receiverID,
        canonicalTx.amount,
        canonicalTx.timestamp,
        canonicalTx.nonce,
        1,
        JSON.stringify(canonicalTx)
      ]
    );

    return res.json({ code: 1 });

  } catch (err) {
    return res.status(500).json({ code: 0, error: err.message });
  }
};

// =====================================================
// RECEIVE BATCH SYNC
// =====================================================
exports.receiveBatch = async (req, res) => {
  try {
    const batch = req.body;

    if (!batch || !batch.txs || !Array.isArray(batch.txs)) {
      return res.status(400).json({ ok: false, error: "Invalid batch" });
    }


for (let tx of batch.txs) {

  const canonicalTx = {
    tx_hash: String(tx.tx_hash),
    senderID: String(tx.senderID),
    receiverID: String(tx.receiverID),
    amount: Number(tx.amount),
    timestamp: Number(tx.timestamp),
    nonce: Number(tx.nonce),
  };

  // REPLAY CHECK (IMPORTANT)
  const exists = await pool.query(
    `SELECT 1 FROM transactions WHERE tx_hash=$1 LIMIT 1`,
    [canonicalTx.tx_hash]
  );

  if (exists.rows.length > 0) continue;

  // FIRMWARE HASH CHECK
  const txCheck = verifyFirmwareTransaction(
    canonicalTx,
    tx.session_token || ''
  );

  if (!txCheck.ok) continue;

  await pool.query(
    `INSERT INTO transactions
    (tx_hash, sender_id, receiver_id, amount, timestamp, nonce, status, synced, raw_payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)
    ON CONFLICT (tx_hash) DO NOTHING`,
    [
      canonicalTx.tx_hash,
      canonicalTx.senderID,
      canonicalTx.receiverID,
      canonicalTx.amount,
      canonicalTx.timestamp,
      canonicalTx.nonce,
      1,
      JSON.stringify(canonicalTx)
    ]
  );
}

    return res.json({ ok: true });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};

exports.receiveSettlementProof = async (req, res) => {
  try {
    const p = req.body;

    if (!p || !p.proof_hash || !p.device_id) {
      return res.status(400).json({ error: "INVALID_PROOF" });
    }

    // replay protection
    const exists = await pool.query(
      `SELECT 1 FROM settlement_proofs WHERE proof_hash=$1`,
      [p.proof_hash]
    );

    if (exists.rows.length > 0) {
      return res.json({ ok: true, status: "DUPLICATE_IGNORED" });
    }

    await pool.query(
      `INSERT INTO settlement_proofs
      (device_id, ledger_count, merkle_root, prev_merkle_root, timestamp, proof_hash, signature)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        p.device_id,
        p.ledger_count,
        p.merkle_root,
        p.prev_merkle_root,
        p.timestamp,
        p.proof_hash,
        p.signature
      ]
    );

    return res.json({ ok: true });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};


exports.verifySettlementProofLocal = async (req, res) => {
  try {
    const { proof_hash } = req.params;

    const result = await pool.query(
      `SELECT * FROM settlement_proofs WHERE proof_hash=$1`,
      [proof_hash]
    );

    if (!result.rows.length) {
      return res.status(404).json({ valid: false });
    }

    const proof = result.rows[0];

    const computedHash = verifyProofHash(proof);

    if (computedHash !== proof.proof_hash) {
      return res.json({ valid: false, reason: "HASH_TAMPER" });
    }

    await pool.query(
      `UPDATE settlement_proofs SET verified=true WHERE proof_hash=$1`,
      [proof.proof_hash]
    );

    return res.json({ valid: true, status: "LOCAL_OK" });

  } catch (err) {
    return res.status(500).json({ valid: false, error: err.message });
  }
};

exports.verifySettlementProofCA = async (req, res) => {
  try {
    const proof = req.body;

    if (!proof?.proof_hash || !proof?.signature || !proof?.device_id) {
      return res.status(400).json({ ok: false, error: "INVALID_PROOF" });
    }

    const TRUST_CA_PUBLIC_KEY = process.env.TRUST_CA_PUBLIC_KEY;

    if (!TRUST_CA_PUBLIC_KEY) {
      return res.status(500).json({ ok: false, error: "TRUST_CA_NOT_SET" });
    }

    const isValid = cryptoVerify(
      proof.proof_hash,
      proof.signature,
      TRUST_CA_PUBLIC_KEY
    );

    if (!isValid) {
      return res.status(403).json({
        ok: false,
        error: "TRUST_ANCHOR_REJECTED"
      });
    }

    const latest = await pool.query(
      `SELECT ledger_count FROM devices WHERE device_id=$1`,
      [proof.device_id]
    );

    if (!latest.rows.length) {
      return res.status(404).json({ ok: false, error: "UNKNOWN_DEVICE" });
    }

    if (Number(proof.ledger_count) < latest.rows[0].ledger_count) {
      return res.status(409).json({ ok: false, error: "STALE_LEDGER" });
    }

    await pool.query(
      `UPDATE devices
       SET ledger_count=$1,
           last_merkle_root=$2,
           last_seen=NOW()
       WHERE device_id=$3`,
      [proof.ledger_count, proof.merkle_root, proof.device_id]
    );

    return res.json({
      ok: true,
      status: "SETTLEMENT_FINALIZED"
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};

// =====================================================
// GET LATEST LEDGER HASH
// =====================================================
exports.getLedgerHash = async (req, res) => {
  try {
    const { deviceId } = req.params;

    const result = await pool.query(
      `SELECT tx_hash FROM transactions
       WHERE sender_id=$1 OR receiver_id=$1
       ORDER BY id DESC LIMIT 1`,
      [deviceId]
    );

    if (!result.rows.length) {
      return res.json({ hash: null });
    }

    return res.json({ hash: result.rows[0].tx_hash });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// =====================================================
// GET FULL LEDGER
// =====================================================
exports.getLedger = async (req, res) => {
  try {
    const { deviceId } = req.params;

    const result = await pool.query(
      `SELECT * FROM transactions
       WHERE sender_id=$1 OR receiver_id=$1
       ORDER BY id ASC`,
      [deviceId]
    );

    return res.json(result.rows);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// =====================================================
// UPDATE NODE STATE
// =====================================================
exports.updateNodeState = async (req, res) => {
  try {
    const { device_id, ledger_count, merkle_root } = req.body;

    await pool.query(
      `INSERT INTO devices(device_id, ledger_count, last_merkle_root, last_seen)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (device_id)
       DO UPDATE SET
         ledger_count=$2,
         last_merkle_root=$3,
         last_seen=NOW()`,
      [device_id, ledger_count, merkle_root]
    );

    return res.json({ ok: true });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.receiveOfflineBatch = async (req, res) => {
  try {
    const batch = req.body;

    if (
      !batch ||
      !batch.device_id ||
      !batch.batch_id ||
      !batch.merkle_root ||
      !Array.isArray(batch.txs)
    ) {
      return res.status(400).json({ error: "INVALID_OFFLINE_BATCH" });
    }

    // replay protection
    const exists = await pool.query(
      `SELECT 1 FROM offline_settlement_queue WHERE batch_id=$1`,
      [batch.batch_id]
    );

    if (exists.rows.length) {
      return res.json({ status: "DUPLICATE_IGNORED" });
    }

    // store batch
    await pool.query(
      `INSERT INTO offline_settlement_queue
       (device_id, batch_id, merkle_root, prev_merkle_root, tx_count, payload)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        batch.device_id,
        batch.batch_id,
        batch.merkle_root,
        batch.prev_merkle_root || null,
        batch.txs.length,
        JSON.stringify(batch.txs)
      ]
    );

    return res.json({
      ok: true,
      status: "OFFLINE_BATCH_ACCEPTED"
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};