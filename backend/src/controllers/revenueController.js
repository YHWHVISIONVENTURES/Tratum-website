const pool = require('../db');

exports.summary = async(req,res)=>{
 try{
   const wallets = await pool.query(`SELECT * FROM revenue_wallets ORDER BY wallet_code ASC`);
   const gross = await pool.query(`SELECT COALESCE(SUM(gross_amount),0) total FROM revenue_events`);

   return res.json({
     ok:true,
     total_revenue:gross.rows[0].total,
     wallets:wallets.rows
   });
 }catch(err){
   return res.status(500).json({ok:false,error:err.message});
 }
};

exports.history = async(req,res)=>{
 try{
   const rows = await pool.query(`
     SELECT * FROM revenue_events
     ORDER BY id DESC
     LIMIT 100
   `);
   return res.json({ok:true,data:rows.rows});
 }catch(err){
   return res.status(500).json({ok:false,error:err.message});
 }
};

exports.byFeeType = async(req,res)=>{
 try{
   const rows = await pool.query(`
     SELECT fee_type, SUM(gross_amount) total
     FROM revenue_events
     GROUP BY fee_type
     ORDER BY total DESC
   `);
   return res.json({ok:true,data:rows.rows});
 }catch(err){
   return res.status(500).json({ok:false,error:err.message});
 }
};