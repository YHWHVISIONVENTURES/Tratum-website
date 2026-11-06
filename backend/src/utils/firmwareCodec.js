const crypto = require('crypto');

// -------------------------------------
// HELPERS
// -------------------------------------
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(Number(n));
  return b;
}

function u64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

function hex32(hex) {
  return Buffer.from(hex || ''.padStart(64, '0'), 'hex');
}

function bytes8(v) {
  const b = Buffer.alloc(8);

  if (Buffer.isBuffer(v)) {
    v.copy(b, 0, 0, 8);
    return b;
  }

  Buffer.from(String(v || '')).copy(b, 0, 0, 8);
  return b;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// =====================================================
// TRANSACTION HASH (FIRMWARE EXACT ORDER)
// =====================================================
function computeFirmwareTxHash(tx, sessionTokenHex) {

  const reserved = Buffer.alloc(7, 0);

  const payload = Buffer.concat([
    u32(tx.amount),
    u32(tx.timestamp),
    bytes8(tx.senderID),
    bytes8(tx.receiverID),
    u64(tx.nonce),
    reserved,
    hex32(tx.prev_hash),
    Buffer.from([Number(tx.flags || 0)]),
    hex32(sessionTokenHex)
  ]);

  return sha256(payload);
}

// =====================================================
// SETTLEMENT PROOF HASH
// =====================================================
function computeSettlementProofHash(p) {

  const payload = Buffer.concat([
    bytes8(p.device_id),
    u32(p.ledger_count),
    hex32(p.merkle_root),
    hex32(p.prev_merkle_root),
    u32(p.timestamp)
  ]);

  return sha256(payload);
}

module.exports = {
  computeFirmwareTxHash,
  computeSettlementProofHash
};