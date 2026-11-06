// =======================================================
// FILE: src/controllers/fraudSecurityController.js
// STEP 5 — FRAUD / SECURITY DASHBOARD
// WORLD-CLASS PRODUCTION GRADE
// =======================================================

const pool = require('../db');

function num(v) {
  return Number(v || 0);
}

function riskBand(score) {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  return 'LOW';
}

// -------------------------------------------------------
// GET FRAUD / SECURITY DASHBOARD
// GET /admin/dashboard/security
// -------------------------------------------------------
exports.getFraudSecurityDashboard =
async (req, res) => {
  try {

    const {
      hours = 24
    } = req.query;

    const win =
      Number(hours) || 24;

    const [
      replay,
      duplicateSync,
      badSig,
      spikes,
      revoked,
      alerts,
      recent
    ] = await Promise.all([

      // -----------------------------------
      // REPLAY BLOCKED
      // -----------------------------------
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM security_events
        WHERE event_code='REPLAY_BLOCKED'
        AND created_at >=
          NOW() - ($1 || ' hours')::interval
        `,
        [win]
      ),

      // -----------------------------------
      // DUPLICATE SYNCS
      // -----------------------------------
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM security_events
        WHERE event_code='DUPLICATE_SYNC'
        AND created_at >=
          NOW() - ($1 || ' hours')::interval
        `,
        [win]
      ),

      // -----------------------------------
      // FAILED SIGNATURES
      // -----------------------------------
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM security_events
        WHERE event_code='FAILED_SIGNATURE'
        AND created_at >=
          NOW() - ($1 || ' hours')::interval
        `,
        [win]
      ),

      // -----------------------------------
      // SPIKES
      // -----------------------------------
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM security_events
        WHERE event_code='SUSPICIOUS_SPIKE'
        AND created_at >=
          NOW() - ($1 || ' hours')::interval
        `,
        [win]
      ),

      // -----------------------------------
      // REVOKED CERT ATTEMPTS
      // -----------------------------------
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM security_events
        WHERE event_code='REVOKED_CERT_ATTEMPT'
        AND created_at >=
          NOW() - ($1 || ' hours')::interval
        `,
        [win]
      ),

      // -----------------------------------
      // OPEN ALERTS
      // -----------------------------------
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM fraud_alerts
        WHERE resolved = FALSE
        `
      ),

      // -----------------------------------
      // RECENT ALERT FEED
      // -----------------------------------
      pool.query(
        `
        SELECT
          id,
          severity,
          actor_id,
          alert_code,
          details,
          created_at,
          resolved
        FROM fraud_alerts
        ORDER BY id DESC
        LIMIT 50
        `
      )
    ]);

    // -----------------------------------
    // RISK SCORE
    // -----------------------------------
    const replayCount =
      num(replay.rows[0]?.count);

    const dupCount =
      num(duplicateSync.rows[0]?.count);

    const sigCount =
      num(badSig.rows[0]?.count);

    const spikeCount =
      num(spikes.rows[0]?.count);

    const revokedCount =
      num(revoked.rows[0]?.count);

    const openAlerts =
      num(alerts.rows[0]?.count);

    const score =
      Math.min(
        100,
        replayCount * 2 +
        dupCount * 2 +
        sigCount * 4 +
        spikeCount * 6 +
        revokedCount * 8 +
        openAlerts * 5
      );

    // -----------------------------------
    // RESPONSE
    // -----------------------------------
    return res.json({
      ok: true,
      dashboard: 'FRAUD_SECURITY',

      window_hours: win,

      summary: {
        replay_blocked:
          replayCount,

        duplicate_syncs:
          dupCount,

        failed_signatures:
          sigCount,

        suspicious_spikes:
          spikeCount,

        revoked_cert_attempts:
          revokedCount,

        fraud_alerts_open:
          openAlerts,

        risk_score:
          score,

        risk_band:
          riskBand(score)
      },

      alerts:
        recent.rows
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
};