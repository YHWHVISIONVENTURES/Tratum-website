const pool = require('../db');

exports.getLogs = async (req,res)=>{
 try{
   const id = req.institution.id;

   const rows = await pool.query(`
     SELECT *
     FROM api_audit_logs
     WHERE actor_id=$1
     ORDER BY id DESC
     LIMIT 100
   `,[id]);

   res.json({
     ok:true,
     dashboard:'PORTAL_LOGS',
     logs:rows.rows
   });

 }catch(err){
   res.status(500).json({
     ok:false,
     error:err.message
   });
 }
};
