// =======================================================
// FILE: src/analytics/analyticsEngine.js
// TRATUM SOVEREIGN ANALYTICS AGGREGATION CORE
// =======================================================

const EventEmitter = require('events');

const pool = require('../db');

class AnalyticsEngine extends EventEmitter {

  constructor() {
    super();

    this.state = {
      initialized: false,
      lastTick: null,
      cache: {
        treasury: null,
        sovereign: null,
        corridors: null,
        nodes: null,
        revenue: null,
        fraud: null,
        institutions: null
      }
    };

    this.intervals = [];
  }

  // ---------------------------------------------------
  // INITIALIZE
  // ---------------------------------------------------
  async initialize() {

    if (this.state.initialized) {
      return;
    }

    this.state.initialized = true;

    // PRIME SNAPSHOTS
    await this.refreshAll();

    // -----------------------------------------------
    // FAST METRICS LOOP
    // -----------------------------------------------
    this.intervals.push(
      setInterval(async () => {
        try {
          await this.refreshRealtimeMetrics();
        } catch (err) {
          console.error(
            '[ANALYTICS REALTIME LOOP]',
            err.message
          );
        }
      }, 5000)
    );

    // -----------------------------------------------
    // HEAVY AGGREGATION LOOP
    // -----------------------------------------------
    this.intervals.push(
      setInterval(async () => {
        try {
          await this.refreshAll();
        } catch (err) {
          console.error(
            '[ANALYTICS FULL LOOP]',
            err.message
          );
        }
      }, 60000)
    );

    console.log(
      '[ANALYTICS ENGINE] initialized'
    );
  }

  // ---------------------------------------------------
  // STOP
  // ---------------------------------------------------
  shutdown() {

    for (const interval of this.intervals) {
      clearInterval(interval);
    }

    this.intervals = [];

    console.log(
      '[ANALYTICS ENGINE] shutdown complete'
    );
  }

  // ---------------------------------------------------
  // REFRESH EVERYTHING
  // ---------------------------------------------------
  async refreshAll() {

    const [
      treasury,
      sovereign,
      corridors,
      nodes,
      revenue,
      fraud,
      institutions
    ] = await Promise.all([

      this.computeTreasuryMetrics(),
      this.computeSovereignMetrics(),
      this.computeCorridorMetrics(),
      this.computeNodeMetrics(),
      this.computeRevenueMetrics(),
      this.computeFraudMetrics(),
      this.computeInstitutionMetrics()
    ]);

    this.state.cache = {
      treasury,
      sovereign,
      corridors,
      nodes,
      revenue,
      fraud,
      institutions
    };

    this.state.lastTick = Date.now();

    this.emit('analytics.updated', {
      timestamp: this.state.lastTick,
      cache: this.state.cache
    });
  }

  // ---------------------------------------------------
  // REALTIME ONLY
  // ---------------------------------------------------
  async refreshRealtimeMetrics() {

    const [
      treasuryPressure,
      txVelocity,
      syncPressure,
      fraudPressure
    ] = await Promise.all([

      this.computeTreasuryPressure(),
      this.computeRealtimeVelocity(),
      this.computeRealtimeQueuePressure(),
      this.computeRealtimeFraudSignals()
    ]);

    const realtime = {
      treasury_pressure:
        treasuryPressure,

      tx_velocity:
        txVelocity,

      sync_pressure:
        syncPressure,

      fraud_pressure:
        fraudPressure,

      generated_at:
        Date.now()
    };

    this.state.cache.realtime = realtime;

    this.emit(
      'analytics.realtime',
      realtime
    );
  }

  // ---------------------------------------------------
  // TREASURY
  // ---------------------------------------------------
  async computeTreasuryMetrics() {

    const [
      fiat,
      liabilities,
      obligations,
      stablecoin,
      wallets
    ] = await Promise.all([

      pool.query(`
        SELECT COALESCE(
          SUM(amount),0
        ) total
        FROM fiat_reserves
      `),

      pool.query(`
        SELECT COALESCE(
          SUM(amount),0
        ) total
        FROM treasury_liabilities
        WHERE settled = FALSE
      `),

      pool.query(`
        SELECT COALESCE(
          SUM(amount),0
        ) total
        FROM interbank_settlements
        WHERE status='PENDING'
      `),

      pool.query(`
        SELECT
          token,
          COALESCE(
            SUM(balance),0
          ) balance
        FROM stablecoin_reserves
        GROUP BY token
      `),

      pool.query(`
        SELECT
          wallet_code,
          wallet_name,
          balance
        FROM revenue_wallets
        ORDER BY balance DESC
      `)
    ]);

    const reserveFloat =
      Number(fiat.rows[0]?.total || 0);

    const outstandingLiabilities =
      Number(liabilities.rows[0]?.total || 0);

    const settlementPressure =
      Number(obligations.rows[0]?.total || 0);

    const solvencyRatio =
      outstandingLiabilities > 0
        ? Number(
            (
              reserveFloat /
              outstandingLiabilities
            ).toFixed(4)
          )
        : 1;

    return {
      reserve_float:
        reserveFloat,

      outstanding_liabilities:
        outstandingLiabilities,

      settlement_pressure:
        settlementPressure,

      solvency_ratio:
        solvencyRatio,

      stablecoin_reserves:
        stablecoin.rows,

      treasury_wallets:
        wallets.rows,

      generated_at:
        Date.now()
    };
  }

  // ---------------------------------------------------
  // SOVEREIGN
  // ---------------------------------------------------
  async computeSovereignMetrics() {

    const [
      supply,
      mintBurn,
      tx,
      rails
    ] = await Promise.all([

      pool.query(`
        SELECT
          currency_code,
          total_issued
        FROM sovereign_supply
      `),

      pool.query(`
        SELECT
          event_type,
          COALESCE(
            SUM(amount),0
          ) total
        FROM sovereign_events
        GROUP BY event_type
      `),

      pool.query(`
        SELECT COUNT(*)::bigint total
        FROM transactions
      `),

      pool.query(`
        SELECT COUNT(*)::bigint total
        FROM rail_transactions
      `)
    ]);

    return {
      sovereign_supply:
        supply.rows,

      sovereign_events:
        mintBurn.rows,

      total_transactions:
        Number(tx.rows[0]?.total || 0),

      rail_operations:
        Number(rails.rows[0]?.total || 0),

      generated_at:
        Date.now()
    };
  }

  // ---------------------------------------------------
  // CORRIDOR FLOW
  // ---------------------------------------------------
  async computeCorridorMetrics() {

    const corridors = await pool.query(`
      SELECT
        route->>'source_country'
          AS source_country,

        route->>'destination_country'
          AS destination_country,

        COUNT(*)::int AS tx_count,

        COALESCE(
          SUM(
            (
              payload->>'amount'
            )::numeric
          ),0
        ) AS total_volume

      FROM rail_transactions

      WHERE route IS NOT NULL

      GROUP BY
        source_country,
        destination_country

      ORDER BY total_volume DESC
    `);

    return {
      corridors:
        corridors.rows,

      generated_at:
        Date.now()
    };
  }

  // ---------------------------------------------------
  // NODE HEALTH
  // ---------------------------------------------------
  async computeNodeMetrics() {

    const [
      totals,
      trust,
      attestations,
      firmware
    ] = await Promise.all([

      pool.query(`
        SELECT
          COUNT(*)::int total,

          COUNT(*) FILTER (
            WHERE status='ACTIVE'
          )::int active

        FROM device_registry
      `),

      pool.query(`
        SELECT
          AVG(trust_score)
            avg_trust,

          COUNT(*) FILTER (
            WHERE attestation_status='VERIFIED'
          )::int verified

        FROM device_trust_state
      `),

      pool.query(`
        SELECT
          result,
          COUNT(*)::int count
        FROM device_attestations
        GROUP BY result
      `),

      pool.query(`
        SELECT
          firmware_hash,
          COUNT(*)::int count
        FROM device_trust_state
        GROUP BY firmware_hash
        ORDER BY count DESC
      `)
    ]);

    return {
      fleet_total:
        Number(totals.rows[0]?.total || 0),

      fleet_active:
        Number(totals.rows[0]?.active || 0),

      average_trust_score:
        Number(trust.rows[0]?.avg_trust || 0),

      verified_attestations:
        Number(trust.rows[0]?.verified || 0),

      attestation_results:
        attestations.rows,

      firmware_distribution:
        firmware.rows,

      generated_at:
        Date.now()
    };
  }

  // ---------------------------------------------------
  // REVENUE
  // ---------------------------------------------------
  async computeRevenueMetrics() {

    const [
      revenue,
      institutions,
      treasuryLedger
    ] = await Promise.all([

      pool.query(`
        SELECT
          DATE_TRUNC(
            'hour',
            created_at
          ) hour,

          COALESCE(
            SUM(gross_amount),0
          ) volume

        FROM revenue_events

        WHERE created_at >=
          NOW() - INTERVAL '24 hours'

        GROUP BY hour

        ORDER BY hour ASC
      `),

      pool.query(`
        SELECT
          actor_id,

          COUNT(*)::int tx_count,

          COALESCE(
            SUM(amount),0
          ) total_volume

        FROM economic_events

        GROUP BY actor_id

        ORDER BY total_volume DESC

        LIMIT 25
      `),

      pool.query(`
        SELECT
          account_code,

          direction,

          COALESCE(
            SUM(amount),0
          ) total

        FROM treasury_ledger

        GROUP BY
          account_code,
          direction
      `)
    ]);

    return {
      revenue_velocity:
        revenue.rows,

      institution_volume:
        institutions.rows,

      treasury_flow:
        treasuryLedger.rows,

      generated_at:
        Date.now()
    };
  }

  // ---------------------------------------------------
  // FRAUD
  // ---------------------------------------------------
  async computeFraudMetrics() {

    const [
      failedRail,
      trustFailures,
      audit,
      failedSignatures
    ] = await Promise.all([

      pool.query(`
        SELECT COUNT(*)::int count
        FROM rail_transactions
        WHERE status='FAILED'
      `),

      pool.query(`
        SELECT COUNT(*)::int count
        FROM device_trust_state
        WHERE failure_count > 0
      `),

      pool.query(`
        SELECT
          action,
          COUNT(*)::int count
        FROM audit_log
        GROUP BY action
        ORDER BY count DESC
        LIMIT 20
      `),

      pool.query(`
        SELECT COUNT(*)::int count
        FROM security_events
        WHERE event_code='FAILED_SIGNATURE'
      `)
    ]);

    return {
      failed_rail_operations:
        Number(failedRail.rows[0]?.count || 0),

      trust_failures:
        Number(trustFailures.rows[0]?.count || 0),

      failed_signatures:
        Number(failedSignatures.rows[0]?.count || 0),

      audit_activity:
        audit.rows,

      generated_at:
        Date.now()
    };
  }

  // ---------------------------------------------------
  // INSTITUTIONS
  // ---------------------------------------------------
  async computeInstitutionMetrics() {

    const [
      institutions,
      issuance,
      railActivity
    ] = await Promise.all([

      pool.query(`
        SELECT
          type,
          status,
          COUNT(*)::int count
        FROM institutions
        GROUP BY type, status
      `),

      pool.query(`
        SELECT
          issuer_id,
          COUNT(*)::int node_count
        FROM device_registry
        GROUP BY issuer_id
        ORDER BY node_count DESC
      `),

      pool.query(`
        SELECT
          actor_id,
          COUNT(*)::int tx_count
        FROM rail_transactions
        GROUP BY actor_id
        ORDER BY tx_count DESC
      `)
    ]);

    return {
      institution_distribution:
        institutions.rows,

      issuance_distribution:
        issuance.rows,

      rail_activity:
        railActivity.rows,

      generated_at:
        Date.now()
    };
  }

  // ---------------------------------------------------
  // REALTIME TREASURY PRESSURE
  // ---------------------------------------------------
  async computeTreasuryPressure() {

    const result = await pool.query(`
      SELECT
        COALESCE(
          SUM(amount),0
        ) total
      FROM interbank_settlements
      WHERE status='PENDING'
    `);

    const pressure =
      Number(result.rows[0]?.total || 0);

    return {
      pressure,
      severity:
        pressure > 100000000
          ? 'HIGH'
          : pressure > 10000000
          ? 'MEDIUM'
          : 'LOW'
    };
  }

  // ---------------------------------------------------
  // REALTIME TX VELOCITY
  // ---------------------------------------------------
  async computeRealtimeVelocity() {

    const result = await pool.query(`
      SELECT COUNT(*)::int count
      FROM transactions
      WHERE created_at >=
        NOW() - INTERVAL '60 seconds'
    `);

    const tx =
      Number(result.rows[0]?.count || 0);

    return {
      tx_last_minute: tx,
      tx_per_second:
        Number((tx / 60).toFixed(2))
    };
  }

  // ---------------------------------------------------
  // REALTIME SYNC PRESSURE
  // ---------------------------------------------------
  async computeRealtimeQueuePressure() {

    const result = await pool.query(`
      SELECT COUNT(*)::int count
      FROM offline_settlement_queue
      WHERE processed = FALSE
    `);

    const pending =
      Number(result.rows[0]?.count || 0);

    return {
      pending_sync_batches:
        pending,

      severity:
        pending > 10000
          ? 'HIGH'
          : pending > 1000
          ? 'MEDIUM'
          : 'LOW'
    };
  }

  // ---------------------------------------------------
  // REALTIME FRAUD SIGNALS
  // ---------------------------------------------------
  async computeRealtimeFraudSignals() {

    const result = await pool.query(`
      SELECT COUNT(*)::int count
      FROM security_events
      WHERE created_at >=
        NOW() - INTERVAL '15 minutes'
    `);

    const events =
      Number(result.rows[0]?.count || 0);

    return {
      suspicious_events:
        events,

      severity:
        events > 100
          ? 'CRITICAL'
          : events > 20
          ? 'WARNING'
          : 'NORMAL'
    };
  }

  // ---------------------------------------------------
  // PUBLIC ACCESSORS
  // ---------------------------------------------------
  getSnapshot() {
    return this.state.cache;
  }

  getRealtimeSnapshot() {
    return this.state.cache.realtime || {};
  }
}

module.exports = new AnalyticsEngine();
