async function assertLicense(client,institution,{reserveNode=false,requiredProduct=null}={}) {
 const found=await client.query("SELECT type FROM institutions WHERE institution_id::text=$1 AND status='active'",[String(institution)]);
 if(!found.rowCount)throw new Error('INSTITUTION_NOT_ACTIVE');
 if(found.rows[0].type!=='ENTERPRISE')return;
 const license=await client.query(`SELECT *,license_expires_at>clock_timestamp() AS fresh FROM enterprise_accounts WHERE institution_id::text=$1 ${reserveNode?'FOR UPDATE':''}`,[String(institution)]);
 const row=license.rows[0];
 if(!row || !row.active || row.license_status!=='ACTIVE' || !row.fresh)throw new Error('ENTERPRISE_LICENSE_INACTIVE');
 if(requiredProduct && !row.licensed_products.includes(requiredProduct))throw new Error('FEATURE_NOT_LICENSED');
 if(reserveNode && !row.licensed_products.includes('FLEET'))throw new Error('FEATURE_NOT_LICENSED');
 if(reserveNode){const count=await client.query(`SELECT count(*) FROM (
  SELECT device_id FROM device_sync_registry_v2 WHERE institution_id=$1
  UNION SELECT lower(device_id) FROM device_registry WHERE enterprise_id=$2 OR issuer_id=$1
 ) licensed_nodes`,[String(institution),row.enterprise_id]);if(BigInt(count.rows[0].count)>=BigInt(row.node_limit))throw new Error('LICENSE_NODE_LIMIT');}
 return row;
}
async function scope(client,user) {
 const own=String(user.institution_id);
 if(user.type==='CENTRAL_BANK' && user.access_role==='SUPERVISOR') {
  const mandate=await client.query('SELECT country_code FROM regulator_directory WHERE institution_id::text=$1 AND active',[own]);
  if(!mandate.rowCount)throw new Error('SUPERVISORY_MANDATE_REQUIRED');
  const result=await client.query('SELECT institution_id::text AS id FROM institutions WHERE country_code=$1 OR institution_id::text=$2',[mandate.rows[0].country_code,own]);
  return {kind:'SUPERVISORY',country:mandate.rows[0].country_code,institutions:result.rows.map(x=>x.id)};
 }
 const license=await assertLicense(client,own,{requiredProduct:user.type==='ENTERPRISE'?'FLEET':null});
 return {kind:user.type==='ENTERPRISE'?'ENTERPRISE':'INSTITUTION',institutions:[own],enterprise_ids:license?[license.enterprise_id]:[]};
}
module.exports={assertLicense,scope};
