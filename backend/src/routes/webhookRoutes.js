const express = require('express');
const crypto = require('node:crypto');
const pool = require('../db');
const auth = require('../middleware/institutionAuth');
const sign = require('../middleware/requestSignerVerify');
const router = express.Router();
router.put('/admin/v2/institutions/:institutionId/webhook',require('../middleware/adminAuth'),require('../middleware/requirePermission')('INSTITUTIONS_MANAGE'),async(req,res,next)=>{
 try {
  const delivery=require('../services/webhookDelivery');
  const {url,secret}=req.body || {};
  if(typeof url!=='string' || url.length>2048 || typeof secret!=='string' || secret.length<32 || secret.length>256) return res.status(400).json({error:'INVALID_WEBHOOK_CONFIGURATION'});
  try {delivery.target(url);}catch{return res.status(400).json({error:'WEBHOOK_TARGET_NOT_ALLOWED'});}
  const encrypted=delivery.encrypt(secret);
  const found=await pool.query(`INSERT INTO institution_webhook_endpoints(institution_id,url,secret_ciphertext)
   SELECT id::text,$2,$3 FROM institutions WHERE id::text=$1 AND status='active'
   ON CONFLICT(institution_id) DO UPDATE SET url=EXCLUDED.url,secret_ciphertext=EXCLUDED.secret_ciphertext,enabled=true,updated_at=now()
   RETURNING institution_id,url,enabled`,[req.params.institutionId,url,encrypted]);
  if(!found.rowCount)return res.status(404).json({error:'INSTITUTION_NOT_FOUND'});
  res.json({ok:true,endpoint:found.rows[0]});
 }catch(error){next(error);}
});
router.delete('/admin/v2/institutions/:institutionId/webhook',require('../middleware/adminAuth'),require('../middleware/requirePermission')('INSTITUTIONS_MANAGE'),async(req,res,next)=>{
 try {await pool.query('UPDATE institution_webhook_endpoints SET enabled=false,updated_at=now() WHERE institution_id=$1',[req.params.institutionId]);res.json({ok:true});}catch(error){next(error);}
});
router.post('/api/v1/institution/webhooks/events', auth, sign, async (req, res, next) => {
  try {
    const { id, type, data } = req.body || {};
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(id) ||
        typeof type !== 'string' || type.length > 128 || !type || !data || typeof data !== 'object') {
      return res.status(400).json({ error: 'INVALID_EVENT' });
    }
    const institutionId = String(req.institution.id);
    const payload = JSON.stringify({ id, type, data });
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    const result = await pool.query(`INSERT INTO institution_webhook_events
      (institution_id,event_id,payload,payload_hash) VALUES ($1,$2,$3,$4)
      ON CONFLICT (institution_id,event_id) DO NOTHING RETURNING event_id`,
    [institutionId, id, payload, hash]);
    if (!result.rowCount) {
      const existing = await pool.query(`SELECT payload_hash FROM institution_webhook_events
        WHERE institution_id=$1 AND event_id=$2`, [institutionId, id]);
      if (existing.rows[0]?.payload_hash !== hash) return res.status(409).json({ error: 'EVENT_ID_CONFLICT' });
    }
    return res.status(result.rowCount ? 202 : 200).json({ ok: true, id, duplicate: !result.rowCount });
  } catch (error) { return next(error); }
});
router.get('/portal/dashboard/webhooks', auth, sign, async (req, res, next) => {
  try {
    const events = await pool.query(`SELECT event_id,payload->>'type' AS type,received_at
      FROM institution_webhook_events WHERE institution_id=$1 ORDER BY received_at DESC LIMIT 100`,
    [String(req.institution.id)]);
    return res.json({ ok: true, events: events.rows });
  } catch (error) { return next(error); }
});
module.exports = router;
