// =======================================================
// FILE: src/analytics/snapshotPipelineEngine.js
// SOVEREIGN SNAPSHOT MATERIALIZATION PIPELINE
// =======================================================

const pool = require('../db');

const {
  buildSovereignMetrics
} = require('./sovereignMetricsEngine');

// =======================================================
// SNAPSHOT WINDOWS
// =======================================================

const SNAPSHOT_WINDOWS = [

  {
    label: '1m',
    intervalMs: 60 * 1000
  },

  {
    label: '5m',
    intervalMs: 5 * 60 * 1000
  },

  {
    label: '15m',
    intervalMs: 15 * 60 * 1000
  },

  {
    label: '1h',
    intervalMs: 60 * 60 * 1000
  },

  {
    label: '24h',
    intervalMs: 24 * 60 * 60 * 1000
  },

  {
    label: '7d',
    intervalMs: 7 * 24 * 60 * 60 * 1000
  },

  {
    label: '30d',
    intervalMs: 30 * 24 * 60 * 60 * 1000
  }
];

// =======================================================
// INTERNAL STATE
// =======================================================

const activeTimers = [];

// =======================================================
// STORE SNAPSHOT
// =======================================================

async function persistSnapshot(
  windowLabel,
  snapshot
) {

  await pool.query(

    `
    INSERT INTO analytics_snapshots
    (
      snapshot_window,
      snapshot_payload,
      generated_at
    )
    VALUES
    ($1, $2, NOW())
    `,

    [
      windowLabel,
      snapshot
    ]
  );
}

// =======================================================
// BUILD SNAPSHOT
// =======================================================

async function buildSnapshot(
  windowLabel
) {

  try {

    console.log(
      `[SNAPSHOT_PIPELINE] Building ${windowLabel} snapshot...`
    );

    // ---------------------------------------------------
    // ROOT METRICS ENGINE
    // ---------------------------------------------------

    const sovereignMetrics =
      await buildSovereignMetrics();

    // ---------------------------------------------------
    // ENRICHED MATERIALIZED SNAPSHOT
    // ---------------------------------------------------

    const snapshot = {

      snapshot_window:
        windowLabel,

      generated_at:
        new Date().toISOString(),

      sovereign_metrics:
        sovereignMetrics
    };

    // ---------------------------------------------------
    // STORE SNAPSHOT
    // ---------------------------------------------------

    await persistSnapshot(
      windowLabel,
      snapshot
    );

    console.log(
      `[SNAPSHOT_PIPELINE] ${windowLabel} snapshot stored`
    );

  } catch (err) {

    console.error(
      `[SNAPSHOT_PIPELINE_ERROR:${windowLabel}]`,
      err.message
    );
  }
}

// =======================================================
// START WINDOW PIPELINE
// =======================================================

function startWindowPipeline(
  windowConfig
) {

  const {
    label,
    intervalMs
  } = windowConfig;

  // ---------------------------------------------------
  // IMMEDIATE INITIAL SNAPSHOT
  // ---------------------------------------------------

  buildSnapshot(label);

  // ---------------------------------------------------
  // RECURRING MATERIALIZATION
  // ---------------------------------------------------

  const timer = setInterval(() => {

    buildSnapshot(label);

  }, intervalMs);

  activeTimers.push(timer);

  console.log(
    `[SNAPSHOT_PIPELINE] ${label} pipeline active`
  );
}

// =======================================================
// INITIALIZE PIPELINE ENGINE
// =======================================================

async function initialize() {

  console.log(
    '[SNAPSHOT_PIPELINE] Initializing...'
  );

  // ---------------------------------------------------
  // START ALL WINDOWS
  // ---------------------------------------------------

  for (const windowConfig of SNAPSHOT_WINDOWS) {

    startWindowPipeline(
      windowConfig
    );
  }

  console.log(
    '[SNAPSHOT_PIPELINE] All snapshot windows active'
  );
}

// =======================================================
// SHUTDOWN
// =======================================================

function shutdown() {

  for (const timer of activeTimers) {
    clearInterval(timer);
  }

  console.log(
    '[SNAPSHOT_PIPELINE] Shutdown complete'
  );
}

// =======================================================
// EXPORTS
// =======================================================

module.exports = {
  initialize,
  shutdown
};