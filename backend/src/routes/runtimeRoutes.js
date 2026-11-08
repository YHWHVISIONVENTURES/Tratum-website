const router = require('express').Router();
const pool = require('../db');
const catalog = require('../services/workerCatalog.json');
const { describeWorker } = require('../services/workerStatus');
router.get('/admin/v1/dashboard/runtime', require('../middleware/adminAuth'),
  require('../middleware/requirePermission')('OPS_VIEW'), async (req, res) => {
    const started = Date.now();
    let database = 'connected';
    try { await pool.query('SELECT 1'); } catch { database = 'unavailable'; }
    const latency = Date.now() - started;
    let workers = { status: 'unavailable', items: [], reason: 'Worker observations unavailable; apply migration 003.' };
    if (database === 'connected') {
      try {
        const result = await pool.query('SELECT * FROM worker_observations ORDER BY worker_name, instance_id LIMIT 500');
        const missing = catalog.filter(name => !result.rows.some(row => row.worker_name === name)).map(name => ({worker_name:name,instance_id:'unobserved',status:'unobserved'}));
        workers = { status: result.rows.length ? 'observed' : 'unobserved', items: [...result.rows.map(row => describeWorker(row)), ...missing],
          reason: 'Cycle completion does not establish settlement correctness. Uninstrumented workers are not shown.' };
      } catch { /* Telemetry schema may not yet be installed. */ }
    }
    res.set('Cache-Control', 'no-store');
    res.status(database === 'connected' ? 200 : 503).json({
      ok: database === 'connected', observed_at: new Date().toISOString(),
      server: { uptime_seconds: Math.floor(process.uptime()), memory_bytes: process.memoryUsage().rss },
      database: { status: database, latency_ms: latency }, workers
    });
  });
module.exports = router;

