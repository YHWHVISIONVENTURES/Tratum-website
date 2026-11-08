const router=require('express').Router();
const pool=require('../db');
const auth=require('../middleware/adminAuth');
const permission=require('../middleware/requirePermission');
const portal=require('./institutionPortalRoutes');
const {scope}=require('../services/fleetAccess');
const fleet=`WITH fleet AS (SELECT COALESCE(v.device_id,lower(d.device_id)) AS device_id,
 COALESCE(v.institution_id,d.issuer_id::text) AS institution_id,COALESCE(v.status,d.status::text) AS status,
 v.expires_at,d.last_seen,v.next_index,v.sync_root,COALESCE(v.key_epoch,t.key_epoch) AS key_epoch,
 COALESCE(v.era_no,t.era_no) AS era_no,COALESCE(v.active_key_slot,t.active_key_slot) AS active_key_slot,
 t.attestation_status,t.lifecycle_observed_at,t.last_state_received_at,v.public_key,r.enterprise_id,r.enterprise_can_suspend
 FROM devices d FULL OUTER JOIN device_sync_registry_v2 v ON v.device_id=lower(d.device_id)
 LEFT JOIN device_trust_state t ON lower(t.device_id)=COALESCE(v.device_id,lower(d.device_id))
 LEFT JOIN device_registry r ON lower(r.device_id)=COALESCE(v.device_id,lower(d.device_id)))`;
const engines=[
 ['Treasury & liquidity','treasuryEngine.js',['treasury_ledger','treasury_locks']],['Fees & billing','billingEngine.js',['billing_ledger','fee_policies']],
 ['Revenue distribution','revenueLedger.js',['revenue_events','revenue_distributions']],['Tax & remittance','taxEngine.js',['tax_transactions','tax_remittance_batches']],
 ['FX & exposure','fxOracle.js',['fx_oracle_cache','fx_exposure']],['Multi-currency settlement','multiCurrencySettlementEngine.js',['settlement_corridors','treasury_liquidity_locks']],
 ['Reconciliation','reconciliationEngine.js',['reconciliation_reports']],['Payout orchestration','payoutEngine.js',['payout_queue','payout_execution_log']],
 ['Sovereign / CBDC','sovereignDistributionEngine.js',['sovereign_events','sovereign_policy']],['Stablecoin bridge','stablecoinBridge.js',['stablecoin_balances','stablecoin_ledger']],
 ['Device trust','deviceLifecycle.js',['device_trust_state','device_key_history']],['Signed device evidence','deviceDeltaCodec.js',['device_delta_batches_v2','device_delta_records_v2']]
];
async function optional(table,sql,params) {
 const exists=await pool.query('SELECT to_regclass($1) IS NOT NULL AS present',['public.'+table]);
 if(!exists.rows[0].present)return {available:false,items:[]};
 try{return {available:true,items:(await pool.query(sql,params)).rows};}catch(error){if(['42703','42P01'].includes(error.code))return {available:false,items:[],reason:'SCHEMA_ALIGNMENT_REQUIRED'};throw error;}
}
async function command(req,res,next) {
 try {
  let access=req.admin?{kind:'TRATUM',institutions:null}:await scope(pool,req.bankUser);
  if(req.query.institution_id){const id=req.query.institution_id;if(typeof id!=='string' || (access.institutions&&!access.institutions.includes(id)))return res.status(403).json({error:'SCOPE_DENIED'});access={...access,institutions:[id]};}
  const ids=access.institutions;
  const enterpriseIds=access.enterprise_ids || [],billingIds=ids?[...ids,...enterpriseIds]:null;
  const after=req.query.after || '';if(typeof after!=='string' || (after&&!/^[a-f0-9]{16}$/.test(after)))return res.status(400).json({error:'INVALID_CURSOR'});
  const [summary,devices,institutions,licenses,batches,webhooks,settlements,billing,era]=await Promise.all([
   pool.query(fleet+` SELECT count(*) AS total,count(*) FILTER(WHERE status='ACTIVE') AS active,
    count(*) FILTER(WHERE attestation_status='VERIFIED') AS attested,
    count(*) FILTER(WHERE lifecycle_observed_at IS NULL) AS lifecycle_unobserved,
    count(*) FILTER(WHERE era_no<(SELECT (value::jsonb->>'era_no')::bigint FROM sync_state WHERE key='TRATUM_TRUST_ERA')) AS era_pending
    FROM fleet WHERE ($1::text[] IS NULL OR institution_id=ANY($1) OR enterprise_id=ANY($2::text[]))`,[ids,enterpriseIds]),
   pool.query(fleet+` SELECT * FROM fleet WHERE ($1::text[] IS NULL OR institution_id=ANY($1) OR enterprise_id=ANY($3::text[])) AND device_id>$2 ORDER BY device_id LIMIT 100`,[ids,after,enterpriseIds]),
   pool.query('SELECT institution_id AS id,name,type,status,country_code FROM institutions WHERE ($1::text[] IS NULL OR institution_id::text=ANY($1)) ORDER BY name LIMIT 1000',[ids]),
   pool.query('SELECT enterprise_id,institution_id,name,license_status,license_expires_at,node_limit,licensed_products FROM enterprise_accounts WHERE ($1::text[] IS NULL OR institution_id::text=ANY($1)) ORDER BY name LIMIT 1000',[ids]),
   pool.query(`SELECT count(*) AS total,max(received_at) AS latest FROM device_delta_batches_v2 WHERE ($1::text[] IS NULL OR institution_id=ANY($1)
    OR device_id IN(SELECT lower(device_id) FROM device_registry WHERE enterprise_id=ANY($2::text[])))`,[ids,enterpriseIds]),
   pool.query('SELECT status,count(*) AS total FROM institution_webhook_outbox WHERE ($1::text[] IS NULL OR institution_id=ANY($1)) GROUP BY status',[ids]),
   optional('settlement_intents','SELECT status,count(*) AS total FROM settlement_intents WHERE ($1::text[] IS NULL OR institution_id::text=ANY($1)) GROUP BY status',[ids]),
   optional('billing_ledger',`SELECT currency_code,SUM(amount)::text AS total_due FROM billing_ledger WHERE paid=false AND ($1::text[] IS NULL OR actor_id=ANY($1)) GROUP BY currency_code`,[billingIds]),
   require('../services/deviceLifecycle').currentEra(pool)
  ]);
  let catalog;
  if(req.admin){const names=[...new Set(engines.flatMap(x=>x[2]))];const found=await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema=\'public\' AND table_name=ANY($1)',[names]);const present=new Set(found.rows.map(x=>x.table_name));catalog=engines.map(([name,file,tables])=>({name,file,code_present:require('node:fs').existsSync(require('node:path').join(__dirname,'../services',file)),schema_present:tables.every(x=>present.has(x)),verification:'SOURCE_AND_SCHEMA_ONLY'}));}
  let signing;if(req.admin){try{require('../security/rootCA').loadRootCa();signing={available:true};}catch{signing={available:false};}}
  res.set('Cache-Control','no-store');res.json({ok:true,observed_at:new Date().toISOString(),scope:access,user:req.bankUser || req.admin,summary:summary.rows[0],devices:devices.rows,next_after:devices.rowCount===100?devices.rows[99].device_id:null,institutions:institutions.rows,licenses:licenses.rows,batches:batches.rows[0],webhooks:webhooks.rows,settlements,billing,era,engines:catalog,signing,financial_finality:false});
 }catch(error){if(['SUPERVISORY_MANDATE_REQUIRED','ENTERPRISE_LICENSE_INACTIVE','FEATURE_NOT_LICENSED'].includes(error.message))return res.status(403).json({error:error.message});next(error);}
}
router.get('/admin/v3/command',auth,permission('OPS_VIEW'),command);
router.get('/portal/v3/command',portal.session,command);
router.get('/admin/v3/devices/:deviceId/history',auth,permission('OPS_VIEW'),async(req,res,next)=>{
 if(!/^[a-f0-9]{16}$/.test(req.params.deviceId))return res.status(400).json({error:'INVALID_DEVICE_ID'});
 try{const [trust,history,certificates]=await Promise.all([
  pool.query('SELECT device_id,key_epoch,era_no,active_key_slot,attestation_status,lifecycle_observed_at,last_state_counter,last_state_body,last_state_received_at FROM device_trust_state WHERE lower(device_id)=$1',[req.params.deviceId]),
  pool.query('SELECT transition_id,transition_kind,transition_status,old_epoch,new_epoch,old_slot,new_slot,era_no,rotated_at,rotated_by FROM device_key_history WHERE lower(device_id)=$1 ORDER BY id DESC LIMIT 100',[req.params.deviceId]),
  pool.query('SELECT certificate_hash,status,issued_at,expiry_at,public_key,issuer_id,certificate_body FROM certificate_records WHERE lower(device_id)=$1 ORDER BY id DESC LIMIT 100',[req.params.deviceId])
 ]);if(!trust.rowCount)return res.status(404).json({error:'DEVICE_NOT_FOUND'});res.set('Cache-Control','no-store');res.json({ok:true,trust:trust.rows[0],history:history.rows,certificates:certificates.rows});}catch(e){next(e);}
});
router.delete('/admin/v3/devices/:deviceId/fleet',auth,permission('LICENSES_MANAGE'),async(req,res,next)=>{
 if(!/^[a-f0-9]{16}$/.test(req.params.deviceId))return res.status(400).json({error:'INVALID_DEVICE_ID'});
 let c;try{c=await pool.connect();await c.query('BEGIN');const found=await c.query('UPDATE device_registry SET enterprise_id=NULL,enterprise_can_suspend=false,updated_at=now() WHERE lower(device_id)=$1 RETURNING device_id',[req.params.deviceId]);if(!found.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'DEVICE_NOT_FOUND'});}
  await c.query("INSERT INTO audit_log(actor_id,action,target_id) VALUES($1,'ENTERPRISE_FLEET_REMOVED',$2)",[String(req.admin.id),req.params.deviceId]);await c.query('COMMIT');res.json({ok:true});
 }catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});next(e);}finally{c?.release();}
});
router.post('/admin/v3/devices/:deviceId/resume',auth,permission('TRUST_MANAGE'),async(req,res,next)=>{
 if(!/^[a-f0-9]{16}$/.test(req.params.deviceId))return res.status(400).json({error:'INVALID_DEVICE_ID'});
 let c;try{c=await pool.connect();await c.query('BEGIN');const found=await c.query('SELECT status FROM device_sync_registry_v2 WHERE device_id=$1 FOR UPDATE',[req.params.deviceId]);
  if(!found.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'DEVICE_NOT_FOUND'});}if(found.rows[0].status==='REVOKED'){await c.query('ROLLBACK');return res.status(409).json({error:'DEVICE_REVOKED'});}
  if(found.rows[0].status==='SUSPENDED'){
   await c.query("UPDATE device_sync_registry_v2 SET status='ACTIVE' WHERE device_id=$1",[req.params.deviceId]);
   await c.query("UPDATE devices SET status='ACTIVE' WHERE lower(device_id)=$1",[req.params.deviceId]);await c.query("UPDATE device_registry SET status='ACTIVE',updated_at=now() WHERE lower(device_id)=$1",[req.params.deviceId]);
   await c.query("UPDATE device_trust_state SET attestation_status='UNVERIFIED',attestation_token=NULL,token_expiry=NULL WHERE lower(device_id)=$1",[req.params.deviceId]);
   await c.query("INSERT INTO audit_log(actor_id,action,target_id) VALUES($1,'DEVICE_RESUMED_REATTESTATION_REQUIRED',$2)",[String(req.admin.id),req.params.deviceId]);
  }
  await c.query('COMMIT');res.json({ok:true,status:'ACTIVE',attestation_required:true});
 }catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});next(e);}finally{c?.release();}
});
router.put('/admin/v3/devices/:deviceId/fleet',auth,permission('LICENSES_MANAGE'),async(req,res,next)=>{
 const enterprise=req.body?.enterprise_id;
 if(!/^[a-f0-9]{16}$/.test(req.params.deviceId) || typeof enterprise!=='string' || enterprise.length>64 || typeof req.body.can_suspend!=='boolean')return res.status(400).json({error:'INVALID_FLEET_ASSIGNMENT'});
 let c;try{
  c=await pool.connect();await c.query('BEGIN');
  const license=await c.query('SELECT *,license_expires_at>now() AS fresh FROM enterprise_accounts WHERE enterprise_id=$1 FOR UPDATE',[enterprise]);
  const l=license.rows[0];if(!l || !l.active || l.license_status!=='ACTIVE' || !l.fresh || !l.licensed_products.includes('FLEET')){await c.query('ROLLBACK');return res.status(403).json({error:'ENTERPRISE_LICENSE_INACTIVE'});}
  const node=await c.query('SELECT * FROM device_registry WHERE lower(device_id)=$1 FOR UPDATE',[req.params.deviceId]);
  if(!node.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'DEVICE_NOT_FOUND'});}
  if(node.rows[0].enterprise_id!==enterprise){const used=await c.query(`SELECT count(*) FROM (${fleet} SELECT device_id FROM fleet WHERE device_id<>$3 AND (institution_id=$1 OR enterprise_id=$2)) nodes`,[String(l.institution_id),enterprise,req.params.deviceId]);if(Number(used.rows[0].count)>=l.node_limit){await c.query('ROLLBACK');return res.status(409).json({error:'LICENSE_NODE_LIMIT'});}}
  await c.query('UPDATE device_registry SET enterprise_id=$2,enterprise_can_suspend=$3,updated_at=now() WHERE lower(device_id)=$1',[req.params.deviceId,enterprise,req.body.can_suspend]);
  await c.query("INSERT INTO audit_log(actor_id,action,target_id,metadata) VALUES($1,'ENTERPRISE_FLEET_ASSIGNED',$2,$3)",[String(req.admin.id),req.params.deviceId,{enterprise_id:enterprise,can_suspend:req.body.can_suspend}]);
  await c.query('COMMIT');res.json({ok:true,enterprise_id:enterprise,device_id:req.params.deviceId});
 }catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});next(e);}finally{c?.release();}
});
router.put('/admin/v3/institutions/:id/license',auth,permission('LICENSES_MANAGE'),async(req,res,next)=>{
 const b=req.body || {};
 if(!['ACTIVE','PENDING','SUSPENDED','EXPIRED'].includes(b.status) || !Number.isInteger(b.node_limit) || b.node_limit<0 || b.node_limit>10000000 || !Array.isArray(b.products) || b.products.some(x=>!['FLEET','OFFLINE_PAYMENTS','API','TELEMETRY'].includes(x)) || !Number.isFinite(Date.parse(b.expires_at)))return res.status(400).json({error:'INVALID_LICENSE'});
 let c;try{c=await pool.connect();await c.query('BEGIN');const inst=await c.query("SELECT * FROM institutions WHERE institution_id::text=$1 AND type='ENTERPRISE' FOR UPDATE",[req.params.id]);if(!inst.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'ENTERPRISE_NOT_FOUND'});}
  const found=await c.query(`INSERT INTO enterprise_accounts(enterprise_id,name,institution_id,license_status,license_expires_at,node_limit,licensed_products)
   VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(institution_id) DO UPDATE SET license_status=$4,license_expires_at=$5,node_limit=$6,licensed_products=$7 RETURNING enterprise_id,institution_id,license_status,node_limit`,['enterprise_'+req.params.id,inst.rows[0].name,req.params.id,b.status,b.expires_at,b.node_limit,JSON.stringify(b.products)]);
  await c.query("INSERT INTO audit_log(actor_id,action,target_id,metadata) VALUES($1,'ENTERPRISE_LICENSE_UPDATED',$2,$3)",[String(req.admin.id),req.params.id,b]);await c.query('COMMIT');res.json({ok:true,license:found.rows[0]});
 }catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});next(e);}finally{c?.release();}
});
router.put('/admin/v3/institutions/:id/supervision',auth,permission('INSTITUTIONS_MANAGE'),async(req,res,next)=>{
 const country=req.body?.country_code;if(typeof country!=='string' || !/^[A-Z]{2,3}$/.test(country))return res.status(400).json({error:'INVALID_COUNTRY'});
 let c;try{c=await pool.connect();await c.query('BEGIN');const result=await c.query(`INSERT INTO regulator_directory(regulator_code,regulator_name,country_code,institution_id,regulator_type)
  SELECT 'TRATUM_'||institution_id,name,$2,institution_id,'CENTRAL_BANK' FROM institutions WHERE institution_id::text=$1 AND type='CENTRAL_BANK'
  ON CONFLICT(institution_id) DO UPDATE SET country_code=$2,active=true RETURNING institution_id,country_code`,[req.params.id,country]);if(!result.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'CENTRAL_BANK_NOT_FOUND'});}
  await c.query("INSERT INTO audit_log(actor_id,action,target_id,metadata) VALUES($1,'SUPERVISORY_MANDATE_ASSIGNED',$2,$3)",[String(req.admin.id),req.params.id,{country_code:country}]);await c.query('COMMIT');res.json({ok:true,mandate:result.rows[0]});
 }catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});next(e);}finally{c?.release();}
});
router.post('/portal/v3/devices/:deviceId/suspend',portal.sameOrigin,portal.session,async(req,res,next)=>{
 let c;try{
  if(req.bankUser.access_role!=='FLEET_OPERATOR')return res.status(403).json({error:'FLEET_OPERATOR_REQUIRED'});
  if(!/^[a-f0-9]{16}$/.test(req.params.deviceId))return res.status(400).json({error:'INVALID_DEVICE_ID'});
  c=await pool.connect();await c.query('BEGIN');
  const license=await require('../services/fleetAccess').assertLicense(c,String(req.bankUser.institution_id),{requiredProduct:'FLEET'});
  const found=await c.query(`SELECT v.status FROM device_sync_registry_v2 v LEFT JOIN device_registry r ON lower(r.device_id)=v.device_id
   WHERE v.device_id=$1 AND (v.institution_id=$2 OR (r.enterprise_id=$3 AND r.enterprise_can_suspend)) FOR UPDATE OF v`,[req.params.deviceId,String(req.bankUser.institution_id),license?.enterprise_id || null]);
  if(!found.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'DEVICE_NOT_FOUND'});}
  if(found.rows[0].status==='REVOKED'){await c.query('ROLLBACK');return res.status(409).json({error:'DEVICE_REVOKED'});}
  if(found.rows[0].status!=='SUSPENDED'){
   await c.query("UPDATE device_sync_registry_v2 SET status='SUSPENDED' WHERE device_id=$1",[req.params.deviceId]);
   await c.query("UPDATE devices SET status='SUSPENDED' WHERE lower(device_id)=$1",[req.params.deviceId]);
   await c.query("UPDATE device_registry SET status='SUSPENDED',updated_at=now() WHERE lower(device_id)=$1",[req.params.deviceId]);
   await c.query("UPDATE device_trust_state SET attestation_status='SUSPENDED',attestation_token=NULL,token_expiry=NULL WHERE lower(device_id)=$1",[req.params.deviceId]);
   await c.query("INSERT INTO audit_log(actor_id,action,target_id,metadata) VALUES($1,'FLEET_DEVICE_SUSPENDED',$2,$3)",['institution-user:'+req.bankUser.id,req.params.deviceId,{institution_id:req.bankUser.institution_id}]);
  }
  await c.query('COMMIT');res.json({ok:true,status:'SUSPENDED'});
 }catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});next(e);}finally{c?.release();}
});
module.exports=router;
