// ==========================================================
// FILE: /services/corridorHealthEngine.js
// ==========================================================

const pool = require('../db');

// ----------------------------------------------------------
// RECORD CORRIDOR EVENT (Hardened with Grouping)
// ----------------------------------------------------------
async function recordCorridorMetric({
  from_country,
  to_country,
  from_currency,
  to_currency,
  rail,
  latency_ms,
  success,
  volume = 0,
  metadata = {}
}) {
  await pool.query(
    `
    INSERT INTO corridor_health_metrics
    (
      from_country, to_country, 
      from_currency, to_currency, 
      rail, latency_ms, success, volume, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [
      from_country, to_country,
      from_currency, to_currency,
      rail, latency_ms, success, volume, metadata
    ]
  );
}

// ----------------------------------------------------------
// HEALTH SCORE (Hardened Grouping)
// ----------------------------------------------------------
async function computeCorridorHealth({
  from_country,
  to_country,
  from_currency,
  to_currency,
  rail
}) {
  // 1. FETCH PERFORMANCE (Success/Latency)
  const result = await pool.query(
    `
    SELECT
      COUNT(*)::int AS total,
      AVG(latency_ms)::numeric(20,2) AS avg_latency,
      SUM(CASE WHEN success=true THEN 1 ELSE 0 END)::int AS success_count
    FROM corridor_health_metrics
    WHERE from_country=$1 AND to_country=$2
      AND from_currency=$3 AND to_currency=$4
      AND rail=$5
      AND created_at >= NOW() - INTERVAL '24 hours'
    `,
    [from_country, to_country, from_currency, to_currency, rail]
  );

  // 2. 🛡️ TREASURY PRESSURE SENSOR (Liquidity Saturation)
  // We check locks matching this specific jurisdictional route
  const pressure = await pool.query(`
    SELECT 
      COUNT(*)::int AS active_locks,
      COALESCE(SUM(source_amount),0) AS locked_volume
    FROM treasury_liquidity_locks
    WHERE source_country = $1 
      AND destination_country = $2
      AND source_currency = $3
      AND status = 'LOCKED'
  `, [from_country, to_country, from_currency]);

  const lockData = pressure.rows[0];
  const row = result.rows[0];
  const total = Number(row.total || 0);

  if (!total) {
    return { score: 100, status: 'IDLE_HEALTHY' };
  }

  const successRate = Number(row.success_count) / total;
  const latency = Number(row.avg_latency || 0);
  
  let score = successRate * 100;

  // 🛡️ PENALTY: Latency (Congestion)
  if (latency > 5000) score -= 25;
  if (latency > 10000) score -= 50;

  // 🛡️ PENALTY: Saturation (Too many pending bags in the hallway)
  if (lockData.active_locks > 50) score -= 15;

  return {
    score: Math.max(0, score),
    latency,
    success_rate: successRate,
    active_locks: lockData.active_locks,
    locked_volume: lockData.locked_volume,
    saturation_level: lockData.active_locks > 50 ? 'HIGH' : 'NORMAL'
  };
}

// ----------------------------------------------------------
// UPDATE CORRIDOR TABLE
// ----------------------------------------------------------
async function refreshCorridorHealth() {
  // Discover all unique active paths
  const corridors = await pool.query(
    `SELECT from_country, to_country, preferred_asset, preferred_rail 
     FROM settlement_corridors WHERE active=true`
  );

  for (const c of corridors.rows) {
    const health = await computeCorridorHealth({
      from_country: c.from_country,
      to_country: c.to_country,
      from_currency: 'NGN', // Hardcoded for base rail or resolve dynamic
      to_currency: c.preferred_asset,
      rail: c.preferred_rail
    });

    await pool.query(
      `
      UPDATE settlement_corridors
      SET health_score=$1, updated_at=NOW()
      WHERE from_country=$2 AND to_country=$3 AND preferred_rail=$4
      `,
      [health.score, c.from_country, c.to_country, c.preferred_rail]
    );
  }
}

module.exports = {
  recordCorridorMetric,
  computeCorridorHealth,
  refreshCorridorHealth
};
