const {
  computeSystemHealth
} = require('../services/systemHealthEngine');

// ---------------------------------------------------
// HEALTH ENDPOINT
// ---------------------------------------------------
exports.getSystemHealth = async (req, res) => {
  try {

    const report = await computeSystemHealth();

    return res.json({
      ok: true,
      timestamp: Date.now(),
      report
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};