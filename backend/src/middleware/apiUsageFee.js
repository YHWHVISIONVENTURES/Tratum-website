const { charge } =
require('../services/feeEngine');

module.exports =
async (req,res,next)=>{

 try {

   await charge(
     'API_CALL',
     1,
     {
       source_ref: req.path,
       currency_code:'NGN'
     }
   );

   next();

 } catch(err){
   return res.status(500).json({
     ok:false,
     error:err.message
   });
 }
};