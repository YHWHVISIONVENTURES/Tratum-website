// =======================================================
// FILE: src/analytics/fraudRiskEngine.js
// ATTACK + ANOMALY + COMPROMISE INTELLIGENCE
// =======================================================

const EventEmitter = require('events');

const pool = require('../db');

// =======================================================
// HELPERS
// =======================================================

function num(v) {
  return Number(v || 0);
}

// =======================================================
// ENGINE
// =======================================================

class FraudRiskEngine
extends EventEmitter {

  constructor() {

    super();

    this.currentState = null;

    this.interval = null;
  }

  // =====================================================
  // INITIALIZE
  // =====================================================

  async initialize() {

    console.log(
      '[FRAUD_RISK_ENGINE] Initializing...'
    );

    // ---------------------------------------------------
    // INITIAL BUILD
    // ---------------------------------------------------

    await this.refresh();

    // ---------------------------------------------------
    // LOOP
    // ---------------------------------------------------

    this.interval =
      setInterval(async () => {

        await this.refresh();

      }, 20 * 1000);

    console.log(
      '[FRAUD_RISK_ENGINE] Active'
    );
  }

  // =====================================================
  // REFRESH
  // =====================================================

  async refresh() {

    try {

      const intelligence =
        await buildFraudIntelligence();

      this.currentState =
        intelligence;

      // -------------------------------------------------
      // BASE EVENT
      // -------------------------------------------------

      this.emit(
        'fraud.intelligence.updated',
        intelligence
      );

      // -------------------------------------------------
      // CRITICAL ATTACK ALERT
      // -------------------------------------------------

      if (
        intelligence.summary
          .risk_score >= 75
      ) {

        this.emit(
          'fraud.critical.detected',
          {
            risk_score:
              intelligence.summary
                .risk_score,

            failed_signatures:
              intelligence.summary
                .failed_signatures,

            timestamp:
              Date.now()
          }
        );
      }

      // -------------------------------------------------
      // COMPROMISED DEVICE CLUSTER
      // -------------------------------------------------

      if (
        intelligence.summary
          .critical_devices > 10
      ) {

        this.emit(
          'fraud.device.cluster',
          {
            critical_devices:
              intelligence.summary
                .critical_devices,

            timestamp:
              Date.now()
          }
        );
      }

      // -------------------------------------------------
      // TREASURY ANOMALY
      // -------------------------------------------------

      if (
        intelligence.summary
          .treasury_anomalies > 0
      ) {

        this.emit(
          'fraud.treasury.anomaly',
          {
            treasury_anomalies:
              intelligence.summary
                .treasury_anomalies,

            timestamp:
              Date.now()
          }
        );
      }

    } catch (err) {

      console.error(
        '[FRAUD_RISK_REFRESH_FAILED]',
        err.message
      );
    }
  }

  // =====================================================
  // CURRENT STATE
  // =====================================================

  getCurrentState() {
    return this.currentState;
  }
}

// =======================================================
// BUILD FRAUD INTELLIGENCE
// =======================================================

async function buildFraudIntelligence() {

  // -----------------------------------------------------
  // PARALLEL QUERIES
  // -----------------------------------------------------

  const [

    securityEvents,

    trustFailures,

    railFailures,

    attestationFailures,

    replayAttacks,

    treasuryAnomalies,

    suspiciousInstitutions,

    attackPatterns

  ] = await Promise.all([

    // ---------------------------------------------------
    // SECURITY EVENTS
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COUNT(*)::int
        AS total_events,

        COUNT(*) FILTER (
          WHERE event_code='FAILED_SIGNATURE'
        )::int
        AS failed_signatures,

        COUNT(*) FILTER (
          WHERE event_code='TIMESTAMP_REJECTED'
        )::int
        AS rejected_timestamps

      FROM security_events

      WHERE created_at >=
        NOW() - INTERVAL '24 hours'
      `
    ),

    // ---------------------------------------------------
    // DEVICE TRUST FAILURES
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COUNT(*) FILTER (
          WHERE trust_score < 55
        )::int
        AS critical_devices,

        COUNT(*) FILTER (
          WHERE failure_count > 3
        )::int
        AS repeated_failures

      FROM device_trust_state
      `
    ),

    // ---------------------------------------------------
    // RAIL FAILURES
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COUNT(*) FILTER (
          WHERE status='FAILED'
        )::int
        AS failed_transactions

      FROM rail_transactions

      WHERE processed_at >=
        NOW() - INTERVAL '24 hours'
      `
    ),

    // ---------------------------------------------------
    // ATTESTATION FAILURES
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COUNT(*) FILTER (
          WHERE result='FAILED'
        )::int
        AS failed_attestations

      FROM device_attestations

      WHERE created_at >=
        NOW() - INTERVAL '24 hours'
      `
    ),

    // ---------------------------------------------------
    // REPLAY / DUPLICATE DETECTION
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        reference,

        COUNT(*)::int
        AS duplicates

      FROM rail_transactions

      WHERE reference IS NOT NULL

      GROUP BY reference

      HAVING COUNT(*) > 1

      ORDER BY duplicates DESC

      LIMIT 25
      `
    ),

    // ---------------------------------------------------
    // TREASURY ANOMALIES
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COUNT(*) FILTER (
          WHERE amount > 100000000
        )::int
        AS abnormal_movements

      FROM treasury_ledger

      WHERE created_at >=
        NOW() - INTERVAL '24 hours'
      `
    ),

    // ---------------------------------------------------
    // INSTITUTIONAL RISK
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        actor_id,

        COUNT(*)::int
        AS failed_ops

      FROM rail_transactions

      WHERE status='FAILED'

      GROUP BY actor_id

      ORDER BY failed_ops DESC

      LIMIT 20
      `
    ),

    // ---------------------------------------------------
    // ATTACK PATTERNS
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        action,

        COUNT(*)::int
        AS frequency

      FROM audit_log

      WHERE created_at >=
        NOW() - INTERVAL '24 hours'

      GROUP BY action

      ORDER BY frequency DESC

      LIMIT 20
      `
    )
  ]);

  // =====================================================
  // EXTRACT
  // =====================================================

  const security =
    securityEvents.rows[0];

  const trust =
    trustFailures.rows[0];

  const rail =
    railFailures.rows[0];

  const attest =
    attestationFailures.rows[0];

  const treasury =
    treasuryAnomalies.rows[0];

  // =====================================================
  // RISK SCORE
  // =====================================================

  let riskScore = 0;

  // failed signatures
  riskScore += Math.min(
    num(security.failed_signatures) * 2,
    25
  );

  // timestamp abuse
  riskScore += Math.min(
    num(security.rejected_timestamps) * 2,
    15
  );

  // failed attestations
  riskScore += Math.min(
    num(attest.failed_attestations) * 3,
    20
  );

  // compromised devices
  riskScore += Math.min(
    num(trust.critical_devices) * 2,
    20
  );

  // failed rails
  riskScore += Math.min(
    num(rail.failed_transactions),
    10
  );

  // treasury anomalies
  riskScore += Math.min(
    num(treasury.abnormal_movements) * 5,
    10
  );

  riskScore =
    Math.min(riskScore, 100);

  // =====================================================
  // RETURN
  // =====================================================

  return {

    generated_at:
      new Date().toISOString(),

    summary: {

      risk_score:
        riskScore,

      failed_signatures:
        num(
          security.failed_signatures
        ),

      rejected_timestamps:
        num(
          security.rejected_timestamps
        ),

      failed_attestations:
        num(
          attest.failed_attestations
        ),

      critical_devices:
        num(
          trust.critical_devices
        ),

      repeated_failures:
        num(
          trust.repeated_failures
        ),

      failed_rail_transactions:
        num(
          rail.failed_transactions
        ),

      treasury_anomalies:
        num(
          treasury.abnormal_movements
        )
    },

    suspicious_references:
      replayAttacks.rows,

    suspicious_institutions:
      suspiciousInstitutions.rows,

    attack_patterns:
      attackPatterns.rows
  };
}

// =======================================================
// SINGLETON
// =======================================================

const engine =
new FraudRiskEngine();

// =======================================================
// EXPORTS
// =======================================================

module.exports = engine;

module.exports.buildFraudIntelligence =
buildFraudIntelligence;