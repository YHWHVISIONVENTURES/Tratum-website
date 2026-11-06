// =======================================================
// FILE: src/analytics/corridorAnalyticsEngine.js
// AFRICA SOVEREIGN SETTLEMENT GRAPH ENGINE
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

class CorridorAnalyticsEngine
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
      '[CORRIDOR_ANALYTICS] Initializing...'
    );

    // ---------------------------------------------------
    // INITIAL BUILD
    // ---------------------------------------------------

    await this.refresh();

    // ---------------------------------------------------
    // LIVE LOOP
    // ---------------------------------------------------

    this.interval =
      setInterval(async () => {

        await this.refresh();

      }, 45 * 1000);

    console.log(
      '[CORRIDOR_ANALYTICS] Active'
    );
  }

  // =====================================================
  // REFRESH
  // =====================================================

  async refresh() {

    try {

      const analytics =
        await buildCorridorAnalytics();

      this.currentState =
        analytics;

      // -------------------------------------------------
      // BASE EVENT
      // -------------------------------------------------

      this.emit(
        'corridor.analytics.updated',
        analytics
      );

      // -------------------------------------------------
      // CONGESTION ALERTS
      // -------------------------------------------------

      for (
        const corridor of
        analytics.corridors
      ) {

        if (
          corridor.pending_operations >= 25
        ) {

          this.emit(
            'corridor.congestion.detected',
            {
              corridor:
                corridor.corridor_code,

              pending_operations:
                corridor.pending_operations,

              timestamp:
                Date.now()
            }
          );
        }
      }

      // -------------------------------------------------
      // LIQUIDITY WARNING
      // -------------------------------------------------

      for (
        const corridor of
        analytics.corridors
      ) {

        if (
          corridor.net_flow <
          -5000000
        ) {

          this.emit(
            'corridor.liquidity.imbalance',
            {
              corridor:
                corridor.corridor_code,

              net_flow:
                corridor.net_flow,

              timestamp:
                Date.now()
            }
          );
        }
      }

    } catch (err) {

      console.error(
        '[CORRIDOR_ANALYTICS_REFRESH_FAILED]',
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
// BUILD ANALYTICS
// =======================================================

async function buildCorridorAnalytics() {

  // -----------------------------------------------------
  // FLOW GRAPH
  // -----------------------------------------------------

  const [

    corridorFlows,

    corridorBalances,

    railTraffic,

    congestion,

    institutions,

    economicFlow

  ] = await Promise.all([

    // ---------------------------------------------------
    // TREASURY FLOW GRAPH
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COALESCE(
          metadata->>'corridor_code',
          'UNASSIGNED'
        ) AS corridor_code,

        COUNT(*)::int
        AS transaction_count,

        COALESCE(
          SUM(amount),0
        ) AS total_volume,

        COALESCE(
          SUM(
            CASE
              WHEN direction='CREDIT'
              THEN amount
              ELSE 0
            END
          ),0
        ) AS inflow,

        COALESCE(
          SUM(
            CASE
              WHEN direction='DEBIT'
              THEN amount
              ELSE 0
            END
          ),0
        ) AS outflow

      FROM treasury_ledger

      GROUP BY corridor_code

      ORDER BY total_volume DESC
      `
    ),

    // ---------------------------------------------------
    // CORRIDOR BALANCES
    // ---------------------------------------------------
    pool.query(
      `
      SELECT
        corridor_code,
        balance
      FROM corridor_balances
      ORDER BY corridor_code ASC
      `
    ),

    // ---------------------------------------------------
    // RAIL TRAFFIC
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COALESCE(
          route->>'corridor_code',
          'UNASSIGNED'
        ) AS corridor_code,

        COUNT(*)::int
        AS operations,

        COUNT(*) FILTER (
          WHERE status='FAILED'
        )::int
        AS failed_operations

      FROM rail_transactions

      GROUP BY corridor_code

      ORDER BY operations DESC
      `
    ),

    // ---------------------------------------------------
    // CONGESTION
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COALESCE(
          route->>'corridor_code',
          'UNASSIGNED'
        ) AS corridor_code,

        COUNT(*) FILTER (
          WHERE processed = FALSE
        )::int
        AS pending_operations

      FROM rail_transactions

      GROUP BY corridor_code

      ORDER BY pending_operations DESC
      `
    ),

    // ---------------------------------------------------
    // INSTITUTION DISTRIBUTION
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        type,

        COUNT(*)::int
        AS total

      FROM institutions

      GROUP BY type

      ORDER BY total DESC
      `
    ),

    // ---------------------------------------------------
    // ECONOMIC FLOW
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        currency_code,

        COUNT(*)::int
        AS events,

        COALESCE(
          SUM(amount),0
        ) AS total_amount

      FROM economic_events

      GROUP BY currency_code

      ORDER BY total_amount DESC
      `
    )
  ]);

  // =====================================================
  // NORMALIZE
  // =====================================================

  const congestionMap = {};

  for (
    const item of congestion.rows
  ) {

    congestionMap[
      item.corridor_code
    ] = item;
  }

  const trafficMap = {};

  for (
    const item of railTraffic.rows
  ) {

    trafficMap[
      item.corridor_code
    ] = item;
  }

  const balanceMap = {};

  for (
    const item of corridorBalances.rows
  ) {

    balanceMap[
      item.corridor_code
    ] = item;
  }

  // =====================================================
  // BUILD CORRIDOR GRAPH
  // =====================================================

  const corridors =
    corridorFlows.rows.map(
      (row) => {

        const code =
          row.corridor_code;

        const pending =
          num(
            congestionMap[code]
              ?.pending_operations
          );

        const failed =
          num(
            trafficMap[code]
              ?.failed_operations
          );

        const inflow =
          num(row.inflow);

        const outflow =
          num(row.outflow);

        const netFlow =
          inflow - outflow;

        const congestionScore =
          Math.min(
            100,
            (
              pending * 2
            ) +
            (
              failed * 5
            )
          );

        return {

          corridor_code:
            code,

          transaction_count:
            num(row.transaction_count),

          total_volume:
            num(row.total_volume),

          inflow,

          outflow,

          net_flow:
            netFlow,

          balance:
            num(
              balanceMap[code]
                ?.balance
            ),

          failed_operations:
            failed,

          pending_operations:
            pending,

          congestion_score:
            congestionScore
        };
      }
    );

  // =====================================================
  // SYSTEM SCORE
  // =====================================================

  const totalCongestion =
    corridors.reduce(
      (sum, c) =>
        sum + c.congestion_score,
      0
    );

  const avgCongestion =
    corridors.length > 0
      ? totalCongestion /
        corridors.length
      : 0;

  const corridorHealth =
    Math.max(
      0,
      100 - avgCongestion
    );

  // =====================================================
  // RETURN
  // =====================================================

  return {

    generated_at:
      new Date().toISOString(),

    summary: {

      total_corridors:
        corridors.length,

      average_congestion:
        Number(
          avgCongestion.toFixed(2)
        ),

      corridor_health_score:
        Number(
          corridorHealth.toFixed(2)
        )
    },

    corridors,

    institution_distribution:
      institutions.rows,

    economic_flow:
      economicFlow.rows
  };
}

// =======================================================
// SINGLETON
// =======================================================

const engine =
new CorridorAnalyticsEngine();

// =======================================================
// EXPORTS
// =======================================================

module.exports = engine;

module.exports.buildCorridorAnalytics =
buildCorridorAnalytics;