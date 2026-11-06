const crypto = require('crypto');

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function hexToBuf(hex) {
  return Buffer.from(hex, 'hex');
}

function bufToHex(buf) {
  return Buffer.from(buf).toString('hex');
}

// =====================================================
// BASIC MERKLE ROOT FROM HASH LIST
// input = array of 32-byte hex hashes
// =====================================================
function computeMerkleRoot(hashList) {
  if (!Array.isArray(hashList) || hashList.length === 0) {
    return '0'.repeat(64);
  }

  let level = hashList.map(hexToBuf);

  while (level.length > 1) {
    const next = [];

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] || level[i];

      next.push(
        sha256(Buffer.concat([left, right]))
      );
    }

    level = next;
  }

  return bufToHex(level[0]);
}

// =====================================================
// SEGMENT ROOT
// txHashes = array of tx_hash hex strings
// =====================================================
function computeSegmentRoot(txHashes) {
  return computeMerkleRoot(txHashes);
}

// =====================================================
// FULL ROOT FROM SEGMENTS
// segmentRoots = array of hex roots
// =====================================================
function computeFullRootFromSegments(segmentRoots) {
  return computeMerkleRoot(segmentRoots);
}

// =====================================================
// ROLLING ROOT
// previousRoot + txHash
// =====================================================
function computeRollingRoot(previousRoot, txHash) {
  const prev = hexToBuf(previousRoot || '0'.repeat(64));
  const tx = hexToBuf(txHash);

  return bufToHex(
    sha256(Buffer.concat([prev, tx]))
  );
}

// =====================================================
// VERIFY ROLLING CONTINUITY
// =====================================================
function validateRollingContinuity(previousRoot, txHash, claimedRoot) {
  return computeRollingRoot(previousRoot, txHash) === claimedRoot;
}

// =====================================================
// VERIFY MERKLE PROOF
// path = [{hash, position:left/right}]
// =====================================================
function verifyMerkleProof(txHash, path, expectedRoot) {
  let current = hexToBuf(txHash);

  for (const node of path) {
    const sibling = hexToBuf(node.hash);

    if (node.position === 'left') {
      current = sha256(Buffer.concat([sibling, current]));
    } else {
      current = sha256(Buffer.concat([current, sibling]));
    }
  }

  return bufToHex(current) === expectedRoot;
}

module.exports = {
  computeMerkleRoot,
  computeSegmentRoot,
  computeFullRootFromSegments,
  computeRollingRoot,
  validateRollingContinuity,
  verifyMerkleProof
};