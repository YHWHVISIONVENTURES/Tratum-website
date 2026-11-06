const crypto = require('crypto');
const { buildMerkleRoot } = require('../utils/merkle');

function buildBatch(device_id, txs, prev_merkle_root) {

  const batch_id = crypto.randomBytes(16).toString('hex');

  const merkle_root = buildMerkleRoot(
    txs.map(t => JSON.stringify(t))
  );

  const timestamp = Date.now();

  const payload = {
    batch_id,
    device_id,
    txs,
    merkle_root,
    prev_merkle_root,
    timestamp
  };

  const signature = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');

  return {
    ...payload,
    signature
  };
}

module.exports = { buildBatch };