// =======================================================
// FILE: src/analytics/treasuryIntelligenceEngine.js
// SOVEREIGN TREASURY TELEMETRY ENGINE
// =======================================================

const EventEmitter = require('events');

const pool = require('../db');

// =======================================================
// HELPERS
// =======================================================

function num(v) {
  return Number(v || 0);
}

function pct(a, b) {

  if (!b || b <= 0) {
    return 0;
  }

  return Number(
    ((a / b) * 100).toFixed(2)
  );
}

// =======================================================
// ENGINE
// =======================================================

class TreasuryIntelligenceEngine
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
      '[TREASURY_INTELLIGENCE] Initializing...'
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

      }, 30 * 1000);

    console.log(
      '[TREASURY_INTELLIGENCE] Active'
    );
  }

  // =====================================================
  // REFRESH
  // =====================================================

  async refresh() {

    try {

      const telemetry =
        await buildTreasuryTelemetry();

      this.currentState =
        telemetry;

      // -------------------------------------------------
      // EMIT BASE UPDATE
      // -------------------------------------------------

      this.emit(
        'treasury.telemetry.updated',
        telemetry
      );

      // -------------------------------------------------
      // LIQUIDITY STRESS ALERT
      // -------------------------------------------------

      if (
        telemetry.risk
          .liquidity_pressure_score >= 75
      ) {

        this.emit(
          'treasury.liquidity.stress',
          {
            score:
              telemetry.risk
                .liquidity_pressure_score,

            obligations:
              telemetry.obligations
                .pending_settlement_obligations,

            timestamp:
              Date.now()
          }
        );
      }

      // -------------------------------------------------
      // SOLVENCY ALERT
      // -------------------------------------------------

      if (
        telemetry.risk
          .solvency_ratio < 1
      ) {

        this.emit(
          'treasury.solvency.warning',
          {
            solvency_ratio:
              telemetry.risk
                .solvency_ratio,

            timestamp:
              Date.now()
          }
        );
      }

    } catch (err) {

      console.error(
        '[TREASURY_INTELLIGENCE_REFRESH_FAILED]',
        err.message
      );
    }
  }

  // =====================================================
  // STATE
  // =====================================================

  getCurrentState() {
    return this.currentState;
  }
}

// =======================================================
// BUILD TREASURY TELEMETRY
// =======================================================

async function buildTreasuryTelemetry() {

  // -----------------------------------------------------
  // PARALLEL AGGREGATION
  // -----------------------------------------------------

  const [

    fiatReserves,

    stablecoinReserves,

    sovereignSupply,

    liabilities,

    obligations,

    revenueWallets,

    treasuryLedger,

    settlementBacklog

  ] = await Promise.all([

    // ---------------------------------------------------
    // FIAT RESERVES
    // ---------------------------------------------------
    pool.query(
      `
      SELECT
        COALESCE(
          SUM(amount),0
        ) AS total
      FROM fiat_reserves
      `
    ),

    // ---------------------------------------------------
    // STABLECOIN RESERVES
    // ---------------------------------------------------
    pool.query(
      `
      SELECT
        token,
        COALESCE(
          SUM(balance),0
        ) AS balance
      FROM stablecoin_reserves
      GROUP BY token
      ORDER BY token ASC
      `
    ),

    // ---------------------------------------------------
    // SOVEREIGN SUPPLY
    // ---------------------------------------------------
    pool.query(
      `
      SELECT
        currency_code,
        total_issued
      FROM sovereign_supply
      ORDER BY currency_code ASC
      `
    ),

    // ---------------------------------------------------
    // TREASURY LIABILITIES
    // ---------------------------------------------------
    pool.query(
      `
      SELECT
        COALESCE(
          SUM(amount),0
        ) AS total
      FROM treasury_liabilities
      WHERE settled = FALSE
      `
    ),

    // ---------------------------------------------------
    // INTERBANK OBLIGATIONS
    // ---------------------------------------------------
    pool.query(
      `
      SELECT
        COALESCE(
          SUM(amount),0
        ) AS total
      FROM interbank_settlements
      WHERE status='PENDING'
      `
    ),

    // ---------------------------------------------------
    // REVENUE WALLETS
    // ---------------------------------------------------
    pool.query(
      `
      SELECT
        wallet_code,
        wallet_name,
        balance
      FROM revenue_wallets
      ORDER BY wallet_code ASC
      `
    ),

    // ---------------------------------------------------
    // TREASURY FLOW
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COUNT(*)::int
        AS entries,

        COALESCE(
          SUM(amount),0
        ) AS gross_volume

      FROM treasury_ledger

      WHERE created_at >=
        NOW() - INTERVAL '24 hours'
      `
    ),

    // ---------------------------------------------------
    // BACKLOG
    // ---------------------------------------------------
    pool.query(
      `
      SELECT

        COUNT(*) FILTER (
          WHERE processed = FALSE
        )::int
        AS pending_queue

      FROM rail_transactions
      `
    )
  ]);

  // =====================================================
  // EXTRACT
  // =====================================================

  const fiatFloat =
    num(
      fiatReserves.rows[0]?.total
    );

  const liabilitiesTotal =
    num(
      liabilities.rows[0]?.total
    );

  const pendingObligations =
    num(
      obligations.rows[0]?.total
    );

  const treasuryVolume24h =
    num(
      treasuryLedger.rows[0]
        ?.gross_volume
    );

  const treasuryEntries24h =
    num(
      treasuryLedger.rows[0]
        ?.entries
    );

  const pendingRailQueue =
    num(
      settlementBacklog.rows[0]
        ?.pending_queue
    );

  // =====================================================
  // LIQUIDITY + SOLVENCY
  // =====================================================

  const totalExposure =
    liabilitiesTotal +
    pendingObligations;

  const liquidityCoverage =
    fiatFloat - totalExposure;

  const solvencyRatio =
    totalExposure > 0
      ? Number(
          (
            fiatFloat /
            totalExposure
          ).toFixed(2)
        )
      : 999;

  // =====================================================
  // PRESSURE SCORE
  // =====================================================

  let liquidityPressureScore = 0;

  // reserve depletion
  if (solvencyRatio < 1) {
    liquidityPressureScore += 40;
  }

  // settlement obligations
  if (pendingObligations > 0) {
    liquidityPressureScore += 25;
  }

  // queue congestion
  if (pendingRailQueue > 50) {
    liquidityPressureScore += 20;
  }

  // high treasury movement
  if (treasuryVolume24h > 100000000) {
    liquidityPressureScore += 15;
  }

  liquidityPressureScore =
    Math.min(
      liquidityPressureScore,
      100
    );

  // =====================================================
  // RETURN
  // =====================================================

  return {

    generated_at:
      new Date().toISOString(),

    reserves: {

      fiat_float:
        fiatFloat,

      stablecoin_reserves:
        stablecoinReserves.rows,

      sovereign_supply:
        sovereignSupply.rows
    },

    obligations: {

      pending_settlement_obligations:
        pendingObligations,

      treasury_liabilities:
        liabilitiesTotal
    },

    treasury_flow: {

      treasury_entries_24h:
        treasuryEntries24h,

      treasury_volume_24h:
        treasuryVolume24h
    },

    settlement: {

      pending_rail_queue:
        pendingRailQueue
    },

    wallets: {

      revenue_wallets:
        revenueWallets.rows
    },

    risk: {

      total_exposure:
        totalExposure,

      liquidity_coverage:
        liquidityCoverage,

      solvency_ratio:
        solvencyRatio,

      liquidity_pressure_score:
        liquidityPressureScore
    }
  };
}

// =======================================================
// SINGLETON
// =======================================================

const engine =
new TreasuryIntelligenceEngine();

// =======================================================
// EXPORTS
// =======================================================

module.exports = engine;

module.exports.buildTreasuryTelemetry =
buildTreasuryTelemetry;