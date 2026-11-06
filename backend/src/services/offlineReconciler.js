const pool = require('../db');
const { buildMerkleRoot } = require('../utils/merkle'); // Move import to top

async function reconcileOfflineBatch(batch_id) {
  const batchRes = await pool.query(
    `SELECT * FROM offline_settlement_queue WHERE batch_id=$1`,
    [batch_id]
  );

  if (!batchRes.rows.length) {
    throw new Error("BATCH_NOT_FOUND");
  }

  const batch = batchRes.rows[0];
  
  // 1. Parse the payload ONCE
  const txs = JSON.parse(batch.payload);

  // 2. Cryptographic Integrity Check
  const computedRoot = buildMerkleRoot(
    txs.map(t => JSON.stringify(t))
  );

  if (computedRoot !== batch.merkle_root) {
    throw new Error("MERKLE_ROOT_INVALID");
  }

  // 3. Reconciliation Loop
  for (let tx of txs) {
    await pool.query(
      `INSERT INTO transactions
       (tx_hash, sender_id, receiver_id, amount, timestamp, nonce, status, synced, raw_payload)
       VALUES ($1,$2,$3,$4,$5,$6,1,true,$7)
       ON CONFLICT (tx_hash) DO NOTHING`,
      [
        tx.tx_hash,
        tx.senderID,
        tx.receiverID,
        Number(tx.amount),
        Number(tx.timestamp),
        Number(tx.nonce),
        JSON.stringify({ ...tx, offline: true })
      ]
    );

    // =====================================================
    // 🚨 SECURITY HOOK: REPLAY DETECTION
    // =====================================================
    if (result.rowCount === 0) {
      await pool.query(
        `INSERT INTO security_events (device_id, event_code, metadata)
         VALUES ($1, 'REPLAY_BLOCKED', $2)`,
        [batch.device_id, JSON.stringify({ tx_hash: tx.tx_hash, batch_id })]
      );
      
      console.warn(`[SECURITY] Replay blocked in batch ${batch_id} for hash: ${tx.tx_hash}`);
      continue; // Skip the rest and move to next transaction
    }
    // =====================================================

  }

  // 4. Finalize State
  await pool.query(
    `UPDATE offline_settlement_queue
     SET status='PROCESSED', processed_at=NOW()
     WHERE batch_id=$1`,
    [batch_id]
  );

  return { status: "RECONCILED" };
}

module.exports = { reconcileOfflineBatch };
