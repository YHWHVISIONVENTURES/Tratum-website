// ============================================
// FILE: src/controllers/treasuryDashboardController.js
// ============================================

const pool = require('../db');

function num(v){
  return Number(v || 0);
}

// ------------------------------------
// GET TREASURY DASHBOARD
// GET /admin/dashboard/treasury
// ------------------------------------
exports.getTreasuryDashboard =
async (req,res)=>{

 try {

   const [
     fiat,
     stable,
     cbdc,
     obligations,
     corridors,
     wallets,
     liabilities
   ] = await Promise.all([

     // FIAT FLOAT
     pool.query(`
       SELECT COALESCE(
         SUM(amount),0
       ) total
       FROM fiat_reserves
     `),

     // STABLECOIN RESERVES
     pool.query(`
       SELECT
         token,
         COALESCE(SUM(balance),0) balance
       FROM stablecoin_reserves
       GROUP BY token
       ORDER BY token ASC
     `),

     // CBDC SUPPLY
     pool.query(`
       SELECT
         currency_code,
         total_issued
       FROM sovereign_supply
       ORDER BY currency_code ASC
     `),

     // SETTLEMENT OBLIGATIONS
     pool.query(`
       SELECT COALESCE(
         SUM(amount),0
       ) total
       FROM interbank_settlements
       WHERE status='PENDING'
     `),

     // CORRIDOR BALANCES
     pool.query(`
       SELECT
         corridor_code,
         balance
       FROM corridor_balances
       ORDER BY corridor_code ASC
     `),

     // REVENUE WALLETS
     pool.query(`
       SELECT
         wallet_code,
         wallet_name,
         balance
       FROM revenue_wallets
       ORDER BY wallet_code ASC
     `),

     // LIABILITIES
     pool.query(`
       SELECT COALESCE(
         SUM(amount),0
       ) total
       FROM treasury_liabilities
       WHERE settled = FALSE
     `)
   ]);

   return res.json({
     ok:true,
     dashboard:'TREASURY',

     snapshot:{

       fiat_float:
         num(fiat.rows[0]?.total),

       stablecoin_reserves:
         stable.rows,

       cbdc_supply:
         cbdc.rows,

       settlement_obligations:
         num(obligations.rows[0]?.total),

       corridor_balances:
         corridors.rows,

       revenue_wallets:
         wallets.rows,

       treasury_liabilities:
         num(liabilities.rows[0]?.total)
     }
   });

 } catch(err){

   return res.status(500).json({
     ok:false,
     error:err.message
   });

 }
};