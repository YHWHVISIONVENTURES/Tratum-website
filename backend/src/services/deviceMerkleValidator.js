const {
  computeSegmentRoot,
  computeFullRootFromSegments
} = require('../utils/merkle');

function validateDeviceState(txHashes, segmentRoots, claimedFullRoot) {

  const rebuiltSegments = [];

  for (const group of txHashes) {
    rebuiltSegments.push(
      computeSegmentRoot(group)
    );
  }

  const rebuiltFullRoot =
    computeFullRootFromSegments(rebuiltSegments);

  return {
    ok: rebuiltFullRoot === claimedFullRoot,
    rebuiltSegments,
    rebuiltFullRoot
  };
}

module.exports = {
  validateDeviceState
};