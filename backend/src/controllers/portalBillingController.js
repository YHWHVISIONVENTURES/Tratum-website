const pool = require('../db');

exports.getBilling = async (req,res)=>{
 try{
   const id = req.institution.id;

   const result = await pool.query(`
     SELECT
       COALESCE(SUM(amount),0) total,
       COUNT(*)::int invoices
     FROM billing_ledger
     WHERE actor_id=$1
   `,[id]);

   res.json({
     ok:true,
     dashboard:'PORTAL_BILLING',
     summary:result.rows[0]
   });

 }catch(err){
   res.status(500).json({
     ok:false,
     error:err.message
   });
 }
};
