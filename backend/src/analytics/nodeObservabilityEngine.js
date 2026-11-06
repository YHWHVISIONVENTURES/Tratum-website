// =======================================================
// FILE: src/analytics/nodeObservabilityEngine.js
// HARDWARE + TRUST + FLEET OBSERVABILITY
// =======================================================

const EventEmitter = require('events');

const pool = require('../db');

// =======================================================
// ENGINE
// =======================================================

class NodeObservabilityEngine
extends EventEmitter {

  constructor() {

    super();

    this.currentState = null;

    this.pollInterval = null;
  }

  // =====================================================
  // INITIALIZE
  // =====================================================

  async initialize() {

    console.log(
      '[NODE_OBSERVABILITY] Initializing...'
    );

    // ---------------------------------------------
    // INITIAL BUILD
    // ---------------------------------------------
    await this.refresh();

    // ---------------------------------------------
    // LIVE REFRESH LOOP
    // ---------------------------------------------
    this.pollInterval =
      setInterval(async () => {

        await this.refresh();

      }, 30 * 1000);

    console.log(
      '[NODE_OBSERVABILITY] Active'
    );
  }

  // =====================================================
  // BUILD OBSERVABILITY SNAPSHOT
  // =====================================================

  async refresh() {

    try {

      const observability =
        await buildNodeObservability();

      this.currentState =
        observability;

      // -------------------------------------------
      // EVENT EMIT
      // -------------------------------------------
      this.emit(
        'node.observability.updated',
        observability
      );

      // -------------------------------------------
      // DEGRADED TRUST ALERT
      // -------------------------------------------
      if (
        observability.summary
          .critical_nodes > 0
      ) {

        this.emit(
          'node.trust.degraded',
          {
            critical_nodes:
              observability.summary
                .critical_nodes,

            timestamp:
              Date.now()
          }
        );
      }

      // -------------------------------------------
      // STALE NODE ALERT
      // -------------------------------------------
      if (
        observability.summary
          .stale_nodes > 50
      ) {

        this.emit(
          'node.sync.stale',
          {
            stale_nodes:
              observability.summary
                .stale_nodes,

            timestamp:
              Date.now()
          }
        );
      }

    } catch (err) {

      console.error(
        '[NODE_OBSERVABILITY_REFRESH_FAILED]',
        err.message
      );
    }
  }

  // =====================================================
  // GET CURRENT STATE
  // =====================================================

  getCurrentState() {
    return this.currentState;
  }
}

// =======================================================
// BUILD NODE OBSERVABILITY
// =======================================================

async function buildNodeObservability() {

  // -----------------------------------------------------
  // PARALLEL QUERIES
  // -----------------------------------------------------

  const [

    trustMetrics,

    attestationMetrics,

    firmwareMetrics,

    regionalMetrics,

    issuerMetrics,

    staleMetrics,

    provisioningMetrics

  ] = await Promise.all([

    // ---------------------------------------------------
    // TRUST STATE
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COUNT(*)::int
        AS total_nodes,

        COUNT(*) FILTER (
          WHERE trust_score >= 90
        )::int
        AS healthy_nodes,

        COUNT(*) FILTER (
          WHERE trust_score < 55
        )::int
        AS critical_nodes,

        AVG(trust_score)::numeric(10,2)
        AS avg_trust_score

      FROM device_trust_state
      `
    ),

    // ---------------------------------------------------
    // ATTESTATION
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COUNT(*) FILTER (
          WHERE result='VERIFIED'
        )::int
        AS verified,

        COUNT(*) FILTER (
          WHERE result='FAILED'
        )::int
        AS failed,

        COUNT(*) FILTER (
          WHERE secure_boot=true
        )::int
        AS secure_boot_enabled

      FROM device_attestations
      `
    ),

    // ---------------------------------------------------
    // FIRMWARE DISTRIBUTION
    // ---------------------------------------------------
    pool.query(
      `
      SELECT
        COALESCE(
          firmware_version,
          'UNKNOWN'
        ) AS firmware_version,

        COUNT(*)::int AS count

      FROM devices

      GROUP BY firmware_version

      ORDER BY count DESC
      `
    ),

    // ---------------------------------------------------
    // REGIONAL TELEMETRY
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COALESCE(
          geo_code,
          'UNASSIGNED'
        ) AS geo_code,

        COUNT(*)::int
        AS total

      FROM device_registry

      GROUP BY geo_code

      ORDER BY total DESC
      `
    ),

    // ---------------------------------------------------
    // ISSUER INSTABILITY
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        issuer_id,

        COUNT(*)::int
        AS node_count

      FROM device_registry

      GROUP BY issuer_id

      ORDER BY node_count DESC
      `
    ),

    // ---------------------------------------------------
    // STALE NODES
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COUNT(*) FILTER (
          WHERE last_seen <
            NOW() - INTERVAL '1 day'
        )::int
        AS stale_nodes,

        COUNT(*) FILTER (
          WHERE last_seen <
            NOW() - INTERVAL '5 minutes'
        )::int
        AS offline_nodes

      FROM devices
      `
    ),

    // ---------------------------------------------------
    // PROVISIONING
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COUNT(*)::int
        AS provisioned_nodes,

        COUNT(*) FILTER (
          WHERE created_at >=
            NOW() - INTERVAL '24 hours'
        )::int
        AS provisioned_last_24h

      FROM device_registry
      `
    )
  ]);

  // =====================================================
  // EXTRACT
  // =====================================================

  const trust =
    trustMetrics.rows[0];

  const attest =
    attestationMetrics.rows[0];

  const stale =
    staleMetrics.rows[0];

  const provisioning =
    provisioningMetrics.rows[0];

  // =====================================================
  // HEALTH SCORE
  // =====================================================

  const avgTrust =
    Number(
      trust.avg_trust_score || 0
    );

  const criticalNodes =
    Number(
      trust.critical_nodes || 0
    );

  const staleNodes =
    Number(
      stale.stale_nodes || 0
    );

  const healthScore =
    Math.max(
      0,
      Math.min(
        100,
        (
          avgTrust * 0.7
        ) +
        (
          criticalNodes === 0
            ? 15
            : 5
        ) +
        (
          staleNodes < 10
            ? 15
            : 5
        )
      )
    );

  // =====================================================
  // RETURN
  // =====================================================

  return {

    generated_at:
      new Date().toISOString(),

    summary: {

      total_nodes:
        Number(
          trust.total_nodes || 0
        ),

      healthy_nodes:
        Number(
          trust.healthy_nodes || 0
        ),

      critical_nodes:
        criticalNodes,

      stale_nodes:
        staleNodes,

      avg_trust_score:
        avgTrust,

      observability_score:
        Number(
          healthScore.toFixed(2)
        )
    },

    attestation: {

      verified:
        Number(
          attest.verified || 0
        ),

      failed:
        Number(
          attest.failed || 0
        ),

      secure_boot_enabled:
        Number(
          attest.secure_boot_enabled || 0
        )
    },

    provisioning: {

      total:
        Number(
          provisioning
            .provisioned_nodes || 0
        ),

      last_24h:
        Number(
          provisioning
            .provisioned_last_24h || 0
        )
    },

    firmware_distribution:
      firmwareMetrics.rows,

    regional_distribution:
      regionalMetrics.rows,

    issuer_distribution:
      issuerMetrics.rows
  };
}

// =======================================================
// SINGLETON
// =======================================================

const engine =
new NodeObservabilityEngine();

// =======================================================
// EXPORTS
// =======================================================

module.exports = engine;

module.exports.buildNodeObservability =
buildNodeObservability;