// =======================================================
// FILE: src/controllers/nodeFleetController.js
// WORLD-CLASS NODE FLEET DASHBOARD
// =======================================================

const pool = require('../db');

function num(v) {
  return Number(v || 0);
}

// -------------------------------------------------------
// HEALTH BAND
// -------------------------------------------------------
function healthBand(score) {
  if (score >= 90) return 'EXCELLENT';
  if (score >= 75) return 'GOOD';
  if (score >= 55) return 'WARNING';
  return 'CRITICAL';
}

// -------------------------------------------------------
// GET NODE FLEET DASHBOARD
// GET /admin/dashboard/nodes
// -------------------------------------------------------
exports.getNodeFleetDashboard = async (req, res) => {
  try {

    const {
      issuer_id,
      geo_code,
      deployment_class,
      limit = 100
    } = req.query;

    const filters = [];
    const values = [];
    let p = 1;

    // -----------------------------------
    // FILTERS
    // -----------------------------------
    if (issuer_id) {
      filters.push(`r.issuer_id = $${p++}`);
      values.push(issuer_id);
    }

    if (geo_code) {
      filters.push(`r.geo_code = $${p++}`);
      values.push(geo_code);
    }

    if (deployment_class) {
      filters.push(`r.deployment_class = $${p++}`);
      values.push(deployment_class);
    }

    const whereClause =
      filters.length
        ? `WHERE ${filters.join(' AND ')}`
        : '';

    // -----------------------------------
    // PARALLEL QUERIES
    // -----------------------------------
    const [
      totals,
      firmware,
      regions,
      issuers,
      anomalies,
      fleet
    ] = await Promise.all([

      // TOTAL COUNTS
      pool.query(
        `
        SELECT
          COUNT(*)::int AS total_nodes,

          COUNT(*) FILTER (
            WHERE d.last_seen >=
            NOW() - INTERVAL '5 minutes'
          )::int AS online_nodes,

          COUNT(*) FILTER (
            WHERE d.last_seen <
            NOW() - INTERVAL '5 minutes'
            OR d.last_seen IS NULL
          )::int AS offline_nodes,

          COUNT(*) FILTER (
            WHERE r.status='ACTIVE'
          )::int AS active_registry_nodes

        FROM device_registry r
        LEFT JOIN devices d
          ON d.device_id = r.device_id

        ${whereClause}
        `,
        values
      ),

      // FIRMWARE DISTRIBUTION
      pool.query(
        `
        SELECT
          COALESCE(d.firmware_version,'UNKNOWN')
          AS firmware_version,
          COUNT(*)::int AS count
        FROM device_registry r
        LEFT JOIN devices d
          ON d.device_id = r.device_id
        ${whereClause}
        GROUP BY firmware_version
        ORDER BY count DESC
        `,
        values
      ),

      // REGION MAP
      pool.query(
        `
        SELECT
          COALESCE(r.geo_code,'UNASSIGNED')
          AS geo_code,
          COUNT(*)::int AS count
        FROM device_registry r
        ${whereClause}
        GROUP BY geo_code
        ORDER BY count DESC
        `,
        values
      ),

      // ISSUER MAP
      pool.query(
        `
        SELECT
          COALESCE(r.issuer_id,'DIRECT')
          AS issuer_id,
          COUNT(*)::int AS count
        FROM device_registry r
        ${whereClause}
        GROUP BY issuer_id
        ORDER BY count DESC
        `,
        values
      ),

      // SYNC FAILURES / ANOMALIES
      pool.query(
        `
        SELECT
          COUNT(*) FILTER (
            WHERE processed = FALSE
          )::int AS pending_sync_batches,

          COUNT(*) FILTER (
            WHERE processed = TRUE
            AND processed_at <
            NOW() - INTERVAL '1 day'
          )::int AS stale_processed

        FROM offline_settlement_queue
        `
      ),

      // NODE DETAIL TABLE
      pool.query(
        `
        SELECT
          r.device_id,
          r.alias,
          r.issuer_id,
          r.deployment_class,
          r.geo_code,
          r.status,

          d.last_seen,
          d.ledger_count,
          d.last_merkle_root,
          d.firmware_version,

          CASE
            WHEN d.last_seen >=
              NOW() - INTERVAL '5 minutes'
            THEN 'ONLINE'
            ELSE 'OFFLINE'
          END AS live_status

        FROM device_registry r
        LEFT JOIN devices d
          ON d.device_id = r.device_id

        ${whereClause}

        ORDER BY d.last_seen DESC NULLS LAST
        LIMIT ${Number(limit)}
        `,
        values
      )
    ]);

    // -----------------------------------
    // EXTRACT
    // -----------------------------------
    const totalNodes =
      num(totals.rows[0]?.total_nodes);

    const online =
      num(totals.rows[0]?.online_nodes);

    const offline =
      num(totals.rows[0]?.offline_nodes);

    const activeRegistry =
      num(totals.rows[0]?.active_registry_nodes);

    const pendingSync =
      num(anomalies.rows[0]?.pending_sync_batches);

    const onlinePct =
      totalNodes > 0
        ? Number(
            ((online / totalNodes) * 100)
            .toFixed(2)
          )
        : 0;

    const score =
      Math.max(
        0,
        Math.min(
          100,
          (
            onlinePct * 0.6
          ) +
          (
            pendingSync === 0 ? 25 : 10
          ) +
          (
            activeRegistry > 0 ? 15 : 0
          )
        )
      );

    // -----------------------------------
    // RESPONSE
    // -----------------------------------
    return res.json({
      ok: true,
      dashboard: 'NODE_FLEET',

      summary: {
        total_nodes: totalNodes,
        active_registry_nodes: activeRegistry,
        online_nodes: online,
        offline_nodes: offline,
        online_percentage: onlinePct,
        pending_sync_batches: pendingSync,
        health_score: Number(score.toFixed(2)),
        health_band: healthBand(score)
      },

      fleet_maps: {
        firmware_versions:
          firmware.rows,

        geo_distribution:
          regions.rows,

        issuer_distribution:
          issuers.rows
      },

      nodes:
        fleet.rows
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};