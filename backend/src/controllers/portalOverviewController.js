const pool = require('../db');

exports.getOverview = async (req,res)=>{
 try{
   const id = req.institution.id;

   const [nodes,bill] = await Promise.all([

     pool.query(`
       SELECT COUNT(*)::int count
       FROM device_registry
       WHERE issuer_id=$1
     `,[id]),

     pool.query(`
       SELECT COALESCE(SUM(amount),0) total
       FROM billing_ledger
       WHERE actor_id=$1
     `,[id])

   ]);

   res.json({
     ok:true,
     dashboard:'PORTAL_OVERVIEW',
     summary:{
       nodes:nodes.rows[0].count,
       billed:bill.rows[0].total
     }
   });

 }catch(err){
   res.status(500).json({
     ok:false,
     error:err.message
   });
 }
};
