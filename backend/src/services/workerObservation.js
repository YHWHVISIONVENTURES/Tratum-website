const os = require('node:os');
const pool = require('../db');
const instance = `${os.hostname()}:${process.pid}`;
async function observe(worker, phase) {
 try {
  await pool.query(`INSERT INTO worker_observations
   (worker_name,instance_id,last_started_at,last_finished_at,last_outcome)
   VALUES ($1,$2,CASE WHEN $3='started' THEN clock_timestamp() END,
    CASE WHEN $3<>'started' THEN clock_timestamp() END,CASE WHEN $3<>'started' THEN $3 END)
   ON CONFLICT(worker_name,instance_id) DO UPDATE SET
    last_started_at=CASE WHEN $3='started' THEN clock_timestamp() ELSE worker_observations.last_started_at END,
    last_finished_at=CASE WHEN $3<>'started' THEN clock_timestamp() ELSE worker_observations.last_finished_at END,
    last_outcome=CASE WHEN $3<>'started' THEN $3 ELSE worker_observations.last_outcome END,
    observed_at=clock_timestamp()`,[worker,instance,phase]);
 } catch { console.error('[WORKER OBSERVATION] unavailable'); }
}
module.exports = { observe };
