const router = require('express').Router();
const jwt = require('jsonwebtoken');
const pool = require('../db');
const auth = require('../middleware/institutionAuth');
const { rateLimit } = require('express-rate-limit');
router.post('/bank/v1/session', rateLimit({windowMs:900000,limit:10}), auth, (req,res) => {
 const token=jwt.sign({institution_id:String(req.institution.id),scope:'bank'},process.env.ADMIN_JWT_SECRET,
 {expiresIn:'30m',audience:'tratum-bank',issuer:'tratum'});
 res.set('Cache-Control','no-store').json({token,institution:{id:req.institution.id,name:req.institution.name},expires_in:1800});
});
router.use('/bank/v1',async(req,res,next)=>{
 try {
  const token=/^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  const claims=jwt.verify(token,process.env.ADMIN_JWT_SECRET,{audience:'tratum-bank',issuer:'tratum',algorithms:['HS256']});
  if(claims.scope!=='bank') return res.sendStatus(403);
  const result=await pool.query("SELECT id,name FROM institutions WHERE id=$1 AND status='active'",[claims.institution_id]);
  if(!result.rows.length) return res.sendStatus(401);
  req.institution=result.rows[0]; next();
 } catch { res.status(401).json({error:'BANK_SESSION_REQUIRED'}); }
});
router.get('/bank/v1/me',(req,res)=>res.json({institution:req.institution}));
for(const [section,file,handler] of [
 ['overview','portalOverviewController','getOverview'],['nodes','portalNodesController','getNodes'],
 ['billing','portalBillingController','getBilling'],['logs','PortalLogsController','getLogs']]) {
 router.get(`/bank/v1/${section}`,require(`../controllers/${file}`)[handler]);
}
module.exports=router;
