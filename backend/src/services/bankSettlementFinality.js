const pool = require('../db');
const crypto = require('crypto');
let __FINALITY_LOCK__ = false;

// ---------------------------------------------------
// GET CURRENT GLOBAL ROOT
// ---------------------------------------------------
async function getGlobalRoot() {
  const result = await pool.query(
    `SELECT value
     FROM sync_state
     WHERE key='global_root'
     LIMIT 1`
  );

  if (!result.rows.length) return null;

  return result.rows[0].value;
}

// ---------------------------------------------------
// CHECK IF ROOT ALREADY FINALIZED
// ---------------------------------------------------
async function alreadyFinalized(root) {
  const result = await pool.query(
    `SELECT 1
     FROM bank_settlements
     WHERE global_root=$1
     LIMIT 1`,
    [root]
  );

  return result.rows.length > 0;
}

// ---------------------------------------------------
// BUILD CERTIFICATE HASH
// ---------------------------------------------------
function buildCertificate(root, cycleId, txCount) {
  return crypto.createHash('sha256')
    .update(`${root}|${cycleId}|${txCount}`)
    .digest('hex');
}

// ---------------------------------------------------
// FINALIZE CURRENT WINDOW
// ---------------------------------------------------
async function finalizeWindow() {
  try {
    if (__FINALITY_LOCK__) return null;
    __FINALITY_LOCK__ = true;

    const root = await getGlobalRoot();

    if (!root) {
      __FINALITY_LOCK__ = false;
      return null;
    }

    const exists = await alreadyFinalized(root);

    if (exists) {
      __FINALITY_LOCK__ = false;
      return null;
    }

    const txCountResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM transactions
       WHERE status=1`
    );

    const txCount = txCountResult.rows[0].count;

    const cycleId = Date.now().toString();

    const certHash = buildCertificate(
      root,
      cycleId,
      txCount
    );

    const result = await pool.query(
      `INSERT INTO bank_settlements
       (cycle_id, global_root, tx_count, certificate_hash, status)
       VALUES ($1,$2,$3,$4,'FINALIZED')
       RETURNING *`,
      [
        cycleId,
        root,
        txCount,
        certHash
      ]
    );

    __FINALITY_LOCK__ = false;
    return result.rows[0];

  } catch (err) {
    __FINALITY_LOCK__ = false;
    throw err;
  }
    }

    module.exports = {
  finalizeWindow
    };