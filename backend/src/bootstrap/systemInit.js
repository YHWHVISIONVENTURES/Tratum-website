// =======================================================
// FILE: src/system/systemInit.js
// CLEANED + RESTRUCTURED ANALYTICS INITIALIZATION
// =======================================================

const sovereignMetricsEngine =
require('../analytics/sovereignMetricsEngine');

const snapshotPipelineEngine =
require('../analytics/snapshotPipelineEngine');

const realtimeStateEngine =
require('../services/realtimeStateEngine');

const compliance =
require('../workers/complianceWorker');

const nodeObservabilityEngine =
require('../analytics/nodeObservabilityEngine');

const treasuryIntelligenceEngine =
require('../analytics/treasuryIntelligenceEngine');

const corridorAnalyticsEngine =
require('../analytics/corridorAnalyticsEngine');

const fraudRiskEngine =
require('../analytics/fraudRiskEngine');

module.exports = async function systemInit() {

  console.log(
    '[SYSTEM] Initializing Stratum backend...'
  );

  // =====================================================
  // 1. CORE OPERATIONAL WORKERS
  // =====================================================

  require('../workers/globalRootWorker')
    .start();

  require('../workers/settlementFinalityWorker')
    .start();

  require('../workers/offlineSettlementWorker')
    .start();

  require('../workers/railDispatcherWorker')
    .start();

  require('../workers/reconciliationWorker')
    .start();

  require('../workers/interbankWorker')
    .start();

  require('../workers/merchantSettlementWorker')
    .start();

  require('../workers/merchantWorker')
    .start();

  require('../workers/institutionBillingWorker')
    .start();

  require('../workers/revenueDistributionWorker')
    .start();

  require('../workers/nodeReconciliationWorker')
    .start();

  require('../workers/settlementBridgeWorker')
    .start();

  require('../workers/taxRemittanceWorker')
    .start();

  // =====================================================
  // 2. COMPLIANCE + AML MONITORING
  // =====================================================

  console.log(
    '[SYSTEM] Starting compliance monitoring...'
  );

  // -----------------------------------
  // HIGH-FREQUENCY AML
  // -----------------------------------
  setInterval(() => {

    compliance.runAMLChecks();

    compliance.runSettlementAudit();

  }, 10 * 60 * 1000);

  // -----------------------------------
  // MONTHLY REGULATOR EXPORT
  // -----------------------------------
  setInterval(() => {

    const now = new Date();

    if (
      now.getDate() === 1 &&
      now.getHours() === 0
    ) {

      compliance
        .runMonthlyRegulatorExport();

    }

  }, 60 * 60 * 1000);

  // =====================================================
  // 3. SOVEREIGN ANALYTICS LAYER
  // =====================================================

  try {

    console.log(
      '[SYSTEM] Initializing Sovereign Metrics Engine...'
    );

    await sovereignMetricsEngine
      .initialize();

    // -----------------------------------
    // SNAPSHOT MATERIALIZATION
    // -----------------------------------
    console.log(
      '[SYSTEM] Initializing Snapshot Pipeline Engine...'
    );

    await snapshotPipelineEngine
      .initialize();

    // -----------------------------------
    // REALTIME STATE PROPAGATION
    // -----------------------------------
    console.log(
      '[SYSTEM] Initializing Realtime State Engine...'
    );

    await realtimeStateEngine
      .initialize();

    console.log(
  '[SYSTEM] Initializing Node Observability Engine...'
    );

    await nodeObservabilityEngine
      .initialize();

    // -----------------------------------
// TREASURY INTELLIGENCE
// -----------------------------------

console.log(
  '[SYSTEM] Initializing Treasury Intelligence Engine...'
);

await treasuryIntelligenceEngine
  .initialize();

// -----------------------------------
// CORRIDOR ANALYTICS
// -----------------------------------

console.log(
  '[SYSTEM] Initializing Corridor Analytics Engine...'
);

await corridorAnalyticsEngine
  .initialize();

// -----------------------------------
// FRAUD RISK ENGINE
// -----------------------------------

console.log(
  '[SYSTEM] Initializing Fraud Risk Engine...'
);

await fraudRiskEngine
  .initialize();

    // -----------------------------------
    // ENGINE EVENT WIRING
    // -----------------------------------

    sovereignMetricsEngine.on(
      'metrics.updated',
      async (payload) => {

        try {

          await realtimeStateEngine
            .broadcast(
              'sovereign.metrics',
              payload
            );

        } catch (err) {

          console.error(
            '[REALTIME_METRICS_BROADCAST_FAILED]',
            err.message
          );

        }
      }
    );

    // -----------------------------------
    // TREASURY ALERT PIPELINE
    // -----------------------------------

    sovereignMetricsEngine.on(
      'treasury.alert',
      async (payload) => {

        try {

          await realtimeStateEngine
            .broadcast(
              'treasury.alert',
              payload
            );

        } catch (err) {

          console.error(
            '[TREASURY_ALERT_BROADCAST_FAILED]',
            err.message
          );

        }
      }
    );

    // -----------------------------------
    // CORRIDOR CONGESTION PIPELINE
    // -----------------------------------

    sovereignMetricsEngine.on(
      'corridor.congestion',
      async (payload) => {

        try {

          await realtimeStateEngine
            .broadcast(
              'corridor.congestion',
              payload
            );

        } catch (err) {

          console.error(
            '[CORRIDOR_BROADCAST_FAILED]',
            err.message
          );

        }
      }
    );

  } catch (err) {

    console.error(
      '[CRITICAL_ANALYTICS_FAILURE]',
      err.message
    );

  }

  // -----------------------------------
// NODE OBSERVABILITY EVENTS
// -----------------------------------

nodeObservabilityEngine.on(
  'node.observability.updated',
  async (payload) => {

    try {

      await realtimeStateEngine
        .broadcast(
          'node.observability',
          payload
        );

    } catch (err) {

      console.error(
        '[NODE_OBSERVABILITY_BROADCAST_FAILED]',
        err.message
      );

    }
  }
);

// -----------------------------------
// TRUST DEGRADATION ALERTS
// -----------------------------------

nodeObservabilityEngine.on(
  'node.trust.degraded',
  async (payload) => {

    try {

      await realtimeStateEngine
        .broadcast(
          'node.trust.degraded',
          payload
        );

    } catch (err) {

      console.error(
        '[TRUST_ALERT_BROADCAST_FAILED]',
        err.message
      );

    }
  }
);

// -----------------------------------
// STALE NODE ALERTS
// -----------------------------------

nodeObservabilityEngine.on(
  'node.sync.stale',
  async (payload) => {

    try {

      await realtimeStateEngine
        .broadcast(
          'node.sync.stale',
          payload
        );

    } catch (err) {

      console.error(
        '[STALE_NODE_BROADCAST_FAILED]',
        err.message
      );

    }
  }
);

// -----------------------------------
// TREASURY TELEMETRY
// -----------------------------------

treasuryIntelligenceEngine.on(
  'treasury.telemetry.updated',
  async (payload) => {

    try {

      await realtimeStateEngine
        .broadcast(
          'treasury.telemetry',
          payload
        );

    } catch (err) {

      console.error(
        '[TREASURY_BROADCAST_FAILED]',
        err.message
      );

    }
  }
);

// -----------------------------------
// LIQUIDITY STRESS
// -----------------------------------

treasuryIntelligenceEngine.on(
  'treasury.liquidity.stress',
  async (payload) => {

    try {

      await realtimeStateEngine
        .broadcast(
          'treasury.liquidity.stress',
          payload
        );

    } catch (err) {

      console.error(
        '[TREASURY_STRESS_BROADCAST_FAILED]',
        err.message
      );

    }
  }
);

// -----------------------------------
// SOLVENCY WARNING
// -----------------------------------

treasuryIntelligenceEngine.on(
  'treasury.solvency.warning',
  async (payload) => {

    try {

      await realtimeStateEngine
        .broadcast(
          'treasury.solvency.warning',
          payload
        );

    } catch (err) {

      console.error(
        '[TREASURY_SOLVENCY_BROADCAST_FAILED]',
        err.message
      );

    }
  }
);

// -----------------------------------
// CORRIDOR ANALYTICS
// -----------------------------------

corridorAnalyticsEngine.on(
  'corridor.analytics.updated',
  async (payload) => {

    try {

      await realtimeStateEngine
        .broadcast(
          'corridor.analytics',
          payload
        );

    } catch (err) {

      console.error(
        '[CORRIDOR_BROADCAST_FAILED]',
        err.message
      );

    }
  }
);

// -----------------------------------
// CONGESTION ALERTS
// -----------------------------------

corridorAnalyticsEngine.on(
  'corridor.congestion.detected',
  async (payload) => {

    try {

      await realtimeStateEngine
        .broadcast(
          'corridor.congestion',
          payload
        );

    } catch (err) {

      console.error(
        '[CORRIDOR_CONGESTION_FAILED]',
        err.message
      );

    }
  }
);

// -----------------------------------
// LIQUIDITY IMBALANCE
// -----------------------------------

corridorAnalyticsEngine.on(
  'corridor.liquidity.imbalance',
  async (payload) => {

    try {

      await realtimeStateEngine
        .broadcast(
          'corridor.liquidity.imbalance',
          payload
        );

    } catch (err) {

      console.error(
        '[CORRIDOR_LIQUIDITY_FAILED]',
        err.message
      );

    }
  }
);

// -----------------------------------
// FRAUD INTELLIGENCE
// -----------------------------------

fraudRiskEngine.on(
  'fraud.intelligence.updated',
  async (payload) => {

    try {

      await realtimeStateEngine
        .broadcast(
          'fraud.intelligence',
          payload
        );

    } catch (err) {

      console.error(
        '[FRAUD_BROADCAST_FAILED]',
        err.message
      );

    }
  }
);

// -----------------------------------
// CRITICAL FRAUD ALERT
// -----------------------------------

fraudRiskEngine.on(
  'fraud.critical.detected',
  async (payload) => {

    try {

      await realtimeStateEngine
        .broadcast(
          'fraud.critical',
          payload
        );

    } catch (err) {

      console.error(
        '[FRAUD_CRITICAL_FAILED]',
        err.message
      );

    }
  }
);

// -----------------------------------
// DEVICE CLUSTER ALERT
// -----------------------------------

fraudRiskEngine.on(
  'fraud.device.cluster',
  async (payload) => {

    try {

      await realtimeStateEngine
        .broadcast(
          'fraud.device.cluster',
          payload
        );

    } catch (err) {

      console.error(
        '[FRAUD_CLUSTER_FAILED]',
        err.message
      );

    }
  }
);

// -----------------------------------
// TREASURY ANOMALY
// -----------------------------------

fraudRiskEngine.on(
  'fraud.treasury.anomaly',
  async (payload) => {

    try {

      await realtimeStateEngine
        .broadcast(
          'fraud.treasury.anomaly',
          payload
        );

    } catch (err) {

      console.error(
        '[TREASURY_ANOMALY_FAILED]',
        err.message
      );

    }
  }
);

  // =====================================================
  // SYSTEM ONLINE
  // =====================================================

  console.log(
    '[SYSTEM] Sovereign estate operational'
  );
};