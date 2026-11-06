const pool = require('../db');
const { settleValue } = require('../services/fxOracle');
const { resolveRoute } = require('../services/routingEngine');
const { recordRevenue } = require('../services/revenueLedger'); // 1. IMPORT REVENUE LEDGER

let interval = null;

async function tick() {
  const result = await pool.query(
    `SELECT * FROM merchant_settlements WHERE status='PENDING' ORDER BY id ASC LIMIT 20`
  );

  for (const row of result.rows) {
    try {
      const merchant = await pool.query(
        `SELECT * FROM merchant_profiles WHERE merchant_id=$1 LIMIT 1`,
        [row.merchant_id]
      );

      if (!merchant.rows.length) throw new Error('MERCHANT_PROFILE_NOT_FOUND');
      const m = merchant.rows[0];

      // 2. FEE CALCULATION
      const { bundle } = require('../services/feeEngine');
      const fees = await bundle(['NODE_GAS', 'MERCHANT_MDR'], row.amount);

      const netSettlementAmount = Number(row.amount) - fees.total_fee;

      // 3. ROUTE & FX RESOLUTION
      const route = await resolveRoute({
        from_country: 'GLOBAL',
        to_country: m.country_code,
        asset: row.asset_used
      });

      const fx = await settleValue({
        amount: netSettlementAmount, 
        token: row.asset_used,
        target_currency: m.preferred_currency
      });

      // 4. UPDATE MERCHANT LEDGER (SETTLED)
      await pool.query(
        `UPDATE merchant_settlements
         SET settlement_currency=$2,
             settlement_amount=$3,
             route=$4,
             fee_deducted=$5,
             status='SETTLED',
             settled_at=NOW()
         WHERE id=$1`,
        [row.id, m.preferred_currency, fx.output, JSON.stringify(route), fees.total_fee]
      );
      
      // 5. REPLACE SYSTEM_TREASURY WITH REVENUE_LEDGER (THE WATERFALL)
      await recordRevenue({
        source_type: 'MERCHANT_RAIL',
        source_ref: row.payment_ref,
        fee_type: 'MERCHANT_SETTLEMENT_FEES',
        amount: fees.total_fee,
        currency_code: row.asset_used,
        metadata: { 
          merchant_id: row.merchant_id, 
          fee_breakdown: fees 
        }
      });

      console.log(`[MERCHANT SETTLED] ${row.payment_ref} | Fee: ${fees.total_fee} ${row.asset_used}`);

    } catch (err) {
      await pool.query(
        `UPDATE merchant_settlements SET status='FAILED' WHERE id=$1`,
        [row.id]
      );
      console.error(`[MERCHANT WORKER ERROR] ${row.payment_ref}:`, err.message);
    }
  }
}

function start() {
  if (interval) return;
  interval = setInterval(tick, 5000);
  console.log('[MERCHANT WORKER] ACTIVE');
}

module.exports = { start };
