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
          reason: 'Cycle completion does not establish settlement correctness. Registered workers without observations are shown as unobserved.' };
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
router.get('/admin/v2/network',require('../middleware/adminAuth'),require('../middleware/requirePermission')('OPS_VIEW'),async(req,res,next)=>{
 try {
  const [institutions,devices,batches,webhooks]=await Promise.all([
   pool.query(`SELECT institution_id AS id,name,type,status FROM institutions ORDER BY name,id LIMIT 1000`),
   pool.query(`SELECT institution_id,count(*) AS total,count(*) FILTER(WHERE status='ACTIVE' AND expires_at>now()) AS active FROM device_sync_registry_v2 GROUP BY institution_id`),
   pool.query(`SELECT institution_id,count(*) AS total,max(received_at) AS latest FROM device_delta_batches_v2 GROUP BY institution_id`),
   pool.query(`SELECT institution_id,status,count(*) AS total FROM institution_webhook_outbox GROUP BY institution_id,status`)
  ]);
  const deviceMap=new Map(devices.rows.map(x=>[x.institution_id,x]));
  const batchMap=new Map(batches.rows.map(x=>[x.institution_id,x]));
  res.json({ok:true,observed_at:new Date().toISOString(),institutions:institutions.rows.map(i=>({...i,devices:deviceMap.get(String(i.id)) || {total:'0',active:'0'},batches:batchMap.get(String(i.id)) || {total:'0',latest:null},webhooks:webhooks.rows.filter(x=>x.institution_id===String(i.id))})),financial_finality:false});
 }catch(error){next(error);}
});


