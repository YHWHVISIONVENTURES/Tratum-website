const crypto = require('crypto');
const pool = require('../db');

// -----------------------------------------------------
// HASH COMBINATION (CANONICAL ORDERED)
// -----------------------------------------------------
function hashPair(a, b) {
  const combined = Buffer.concat([
    Buffer.from(a, 'hex'),
    Buffer.from(b, 'hex')
  ]);

  return crypto.createHash('sha256')
    .update(combined)
    .digest('hex');
}

// -----------------------------------------------------
// BUILD GLOBAL ROOT FROM DEVICE ROOTS
// -----------------------------------------------------
async function buildGlobalRoot() {

  const devices = await pool.query(
    `SELECT device_id, last_merkle_root, ledger_count
     FROM devices
     ORDER BY device_id ASC`
  );

  const proofs = await pool.query(
    `SELECT device_id, merkle_root
     FROM settlement_proofs
     WHERE verified = true
     ORDER BY device_id ASC`
  );

  // ---------------------------------------------
  // STEP 1: normalize inputs
  // ---------------------------------------------
  let nodes = [];

  for (let d of devices.rows) {
    if (d.last_merkle_root) {
      nodes.push(d.last_merkle_root);
    }
  }

  for (let p of proofs.rows) {
    nodes.push(p.merkle_root);
  }

  if (nodes.length === 0) {
    return null;
  }

  // ---------------------------------------------
  // STEP 2: sort deterministically (CRITICAL)
  // ---------------------------------------------
  nodes.sort();

  // ---------------------------------------------
  // STEP 3: Merkle-style reduction
  // ---------------------------------------------
  while (nodes.length > 1) {

    let temp = [];

    for (let i = 0; i < nodes.length; i += 2) {

      if (i + 1 < nodes.length) {
        temp.push(hashPair(nodes[i], nodes[i + 1]));
      } else {
        temp.push(hashPair(nodes[i], nodes[i]));
      }
    }

    nodes = temp;
  }

  return nodes[0];
}

module.exports = {
  buildGlobalRoot
};