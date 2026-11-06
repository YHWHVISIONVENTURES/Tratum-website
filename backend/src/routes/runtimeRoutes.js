const router = require('express').Router();
const pool = require('../db');
router.get('/admin/v1/dashboard/runtime', require('../middleware/adminAuth'),
  require('../middleware/requirePermission')('OPS_VIEW'), async (req, res) => {
    const started = Date.now();
    let database = 'connected';
    try { await pool.query('SELECT 1'); } catch { database = 'unavailable'; }
    res.status(database === 'connected' ? 200 : 503).json({
      ok: database === 'connected', observed_at: new Date().toISOString(),
      server: { uptime_seconds: Math.floor(process.uptime()), memory_bytes: process.memoryUsage().rss },
      database: { status: database, latency_ms: Date.now() - started },
      workers: { status: 'unavailable', reason: 'Worker heartbeat reporting is not configured' }
    });
  });
module.exports = router;
