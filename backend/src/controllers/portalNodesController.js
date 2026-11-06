const pool = require('../db');

exports.getNodes = async (req,res)=>{
 try{
   const id = req.institution.id;

   const rows = await pool.query(`
     SELECT
       device_id,
       alias,
       status,
       geo_code,
       last_seen
     FROM device_registry
     WHERE issuer_id=$1
     ORDER BY created_at DESC
   `,[id]);

   res.json({
     ok:true,
     dashboard:'PORTAL_NODES',
     nodes:rows.rows
   });

 }catch(err){
   res.status(500).json({
     ok:false,
     error:err.message
   });
 }
};
