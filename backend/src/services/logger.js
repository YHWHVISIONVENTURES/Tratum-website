// =======================================================
// OPTIONAL LOGGER HELPERS
// FILE: src/services/logger.js
// =======================================================

const pool = require('../db');

exports.logSystem = async (
 source,
 message,
 meta = {}
) => {
 await pool.query(
  `INSERT INTO system_logs
   (source,message,meta)
   VALUES ($1,$2,$3)`,
  [source,message,meta]
 );
};

exports.logWorker = async (
 worker_name,
 message,
 meta = {}
) => {
 await pool.query(
  `INSERT INTO worker_logs
   (worker_name,message,meta)
   VALUES ($1,$2,$3)`,
  [worker_name,message,meta]
 );
};

exports.logApi = async (
 actor_id,
 method,
 path,
 code,
 latency
) => {
 await pool.query(
  `INSERT INTO api_audit_logs
   (actor_id,method,path,status_code,latency_ms)
   VALUES ($1,$2,$3,$4,$5)`,
  [actor_id,method,path,code,latency]
 );
};