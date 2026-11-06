// =======================================================
// FILE: src/analytics/institutionalEconomicsEngine.js
// PURPOSE:
// Institution-grade economic intelligence engine
//
// Tracks:
// - Institution profitability
// - Fee extraction
// - Treasury contribution
// - Liquidity throughput
// - Rail utilization
// - Settlement load
// - Device utilization
// - Corridor usage
//
// THIS IS:
// Economic telemetry infrastructure
// NOT dashboard formatting
// =======================================================

const pool = require('../db');

// =======================================================
// HELPERS
// =======================================================

function num(v) {
  return Number(v || 0);
}

// =======================================================
// MAIN ENGINE
// =======================================================

async function buildInstitutionEconomics({
  institution_id = null,
  windowMinutes = 1440 // default 24h
} = {}) {

  const client = await pool.connect();

  try {

    const filters = [];
    const values = [];
    let p = 1;

    // ---------------------------------------------------
    // TIME WINDOW
    // ---------------------------------------------------

    filters.push(`
      created_at >=
      NOW() - INTERVAL '${Number(windowMinutes)} minutes'
    `);

    // ---------------------------------------------------
    // INSTITUTION FILTER
    // ---------------------------------------------------

    if (institution_id) {
      filters.push(`
        actor_id = $${p++}
      `);

      values.push(
        institution_id
      );
    }

    const whereClause =
      filters.length
        ? `WHERE ${filters.join(' AND ')}`
        : '';

    // ===================================================
    // PARALLEL ECONOMIC QUERIES
    // ===================================================

    const [

      institutionInfo,

      feeRevenue,

      treasuryContribution,

      settlementLoad,

      railActivity,

      liquidityFlow,

      deviceUtilization,

      corridorUsage,

      pendingSettlements,

      failedTransactions

    ] = await Promise.all([

      // -------------------------------------------------
      // INSTITUTION PROFILE
      // -------------------------------------------------
      institution_id
        ? client.query(
            `
            SELECT
              institution_id,
              name,
              type,
              status,
              created_at
            FROM institutions
            WHERE institution_id = $1
            LIMIT 1
            `,
            [institution_id]
          )
        : Promise.resolve({ rows: [] }),

      // -------------------------------------------------
      // FEE EXTRACTION
      // -------------------------------------------------
      client.query(
        `
        SELECT
          COUNT(*)::int AS fee_events,

          COALESCE(
            SUM(amount),
            0
          ) AS total_fee_revenue

        FROM billing_ledger

        ${whereClause}
        `,
        values
      ),

      // -------------------------------------------------
      // TREASURY CONTRIBUTION
      // -------------------------------------------------
      client.query(
        `
        SELECT
          COALESCE(
            SUM(amount),
            0
          ) AS treasury_contribution

        FROM treasury_ledger

        ${institution_id
          ? `
            WHERE source_type = 'INSTITUTION'
            AND metadata->>'institution_id' = $1
          `
          : ''
        }
        `,
        institution_id
          ? [String(institution_id)]
          : []
      ),

      // -------------------------------------------------
      // SETTLEMENT LOAD
      // -------------------------------------------------
      client.query(
        `
        SELECT
          COUNT(*)::int AS settlement_count,

          COALESCE(
            SUM(amount),
            0
          ) AS settlement_volume

        FROM interbank_settlements

        ${
          institution_id
            ? `
              WHERE source_institution = $1
              OR destination_institution = $1
            `
            : ''
        }
        `,
        institution_id
          ? [institution_id]
          : []
      ),

      // -------------------------------------------------
      // RAIL OPERATIONS
      // -------------------------------------------------
      client.query(
        `
        SELECT
          COUNT(*)::int AS rail_ops,

          COUNT(*) FILTER (
            WHERE status='FAILED'
          )::int AS failed_ops

        FROM rail_transactions

        ${
          institution_id
            ? `
              WHERE actor_id = $1
            `
            : ''
        }
        `,
        institution_id
          ? [String(institution_id)]
          : []
      ),

      // -------------------------------------------------
      // LIQUIDITY THROUGHPUT
      // -------------------------------------------------
      client.query(
        `
        SELECT
          COALESCE(
            SUM(amount),
            0
          ) AS liquidity_flow

        FROM economic_events

        ${
          institution_id
            ? `
              WHERE actor_id = $1
            `
            : ''
        }
        `,
        institution_id
          ? [String(institution_id)]
          : []
      ),

      // -------------------------------------------------
      // DEVICE UTILIZATION
      // -------------------------------------------------
      client.query(
        `
        SELECT
          COUNT(*)::int AS total_nodes,

          COUNT(*) FILTER (
            WHERE status='ACTIVE'
          )::int AS active_nodes

        FROM device_registry

        ${
          institution_id
            ? `
              WHERE issuer_id = $1
            `
            : ''
        }
        `,
        institution_id
          ? [String(institution_id)]
          : []
      ),

      // -------------------------------------------------
      // CORRIDOR UTILIZATION
      // -------------------------------------------------
      client.query(
        `
        SELECT
          payload->>'corridor'
            AS corridor,

          COUNT(*)::int AS tx_count

        FROM rail_transactions

        WHERE
          payload->>'corridor'
          IS NOT NULL

          ${
            institution_id
              ? `
                AND actor_id = $1
              `
              : ''
          }

        GROUP BY corridor
        ORDER BY tx_count DESC
        LIMIT 10
        `,
        institution_id
          ? [String(institution_id)]
          : []
      ),

      // -------------------------------------------------
      // PENDING LOAD
      // -------------------------------------------------
      client.query(
        `
        SELECT
          COUNT(*)::int AS pending_batches

        FROM offline_settlement_queue

        ${
          institution_id
            ? `
              WHERE actor_id = $1
              AND processed = FALSE
            `
            : `
              WHERE processed = FALSE
            `
        }
        `,
        institution_id
          ? [String(institution_id)]
          : []
      ),

      // -------------------------------------------------
      // FAILED TX
      // -------------------------------------------------
      client.query(
        `
        SELECT
          COUNT(*)::int AS failed_tx

        FROM rail_transactions

        WHERE status='FAILED'

        ${
          institution_id
            ? `
              AND actor_id = $1
            `
            : ''
        }
        `,
        institution_id
          ? [String(institution_id)]
          : []
      )

    ]);

    // ===================================================
    // EXTRACT
    // ===================================================

    const feeEvents =
      num(
        feeRevenue.rows[0]?.fee_events
      );

    const totalFeeRevenue =
      num(
        feeRevenue.rows[0]?.total_fee_revenue
      );

    const treasuryFlow =
      num(
        treasuryContribution.rows[0]
          ?.treasury_contribution
      );

    const settlementCount =
      num(
        settlementLoad.rows[0]
          ?.settlement_count
      );

    const settlementVolume =
      num(
        settlementLoad.rows[0]
          ?.settlement_volume
      );

    const railOps =
      num(
        railActivity.rows[0]?.rail_ops
      );

    const failedOps =
      num(
        railActivity.rows[0]?.failed_ops
      );

    const liquidityFlow =
      num(
        liquidityFlow.rows[0]
          ?.liquidity_flow
      );

    const totalNodes =
      num(
        deviceUtilization.rows[0]
          ?.total_nodes
      );

    const activeNodes =
      num(
        deviceUtilization.rows[0]
          ?.active_nodes
      );

    const pendingBatches =
      num(
        pendingSettlements.rows[0]
          ?.pending_batches
      );

    const failedTx =
      num(
        failedTransactions.rows[0]
          ?.failed_tx
      );

    // ===================================================
    // EFFICIENCY METRICS
    // ===================================================

    const nodeUtilization =
      totalNodes > 0
        ? Number(
            (
              (activeNodes / totalNodes)
              * 100
            ).toFixed(2)
          )
        : 0;

    const railFailureRate =
      railOps > 0
        ? Number(
            (
              (failedOps / railOps)
              * 100
            ).toFixed(2)
          )
        : 0;

    const economicEfficiencyScore =
      Math.max(
        0,
        Math.min(
          100,
          (
            (nodeUtilization * 0.35) +

            ((railFailureRate < 5 ? 25 : 10)) +

            ((pendingBatches === 0 ? 20 : 8)) +

            ((failedTx === 0 ? 20 : 10))
          )
        )
      );

    // ===================================================
    // RESPONSE
    // ===================================================

    return {

      generated_at:
        new Date().toISOString(),

      institution:
        institutionInfo.rows[0] || null,

      economics: {

        revenue: {
          fee_events: feeEvents,
          total_fee_revenue:
            totalFeeRevenue
        },

        treasury: {
          treasury_contribution:
            treasuryFlow
        },

        settlements: {
          settlement_count:
            settlementCount,

          settlement_volume:
            settlementVolume
        },

        rails: {
          rail_operations:
            railOps,

          failed_operations:
            failedOps,

          failure_rate:
            railFailureRate
        },

        liquidity: {
          throughput:
            liquidityFlow
        },

        infrastructure: {
          total_nodes:
            totalNodes,

          active_nodes:
            activeNodes,

          node_utilization:
            nodeUtilization
        },

        operational_load: {
          pending_batches:
            pendingBatches,

          failed_transactions:
            failedTx
        },

        corridors: {
          top_corridors:
            corridorUsage.rows
        },

        efficiency: {
          score:
            Number(
              economicEfficiencyScore
                .toFixed(2)
            )
        }
      }
    };

  } finally {

    client.release();

  }
}

// =======================================================
// EXPORTS
// =======================================================

module.exports = {
  buildInstitutionEconomics
};