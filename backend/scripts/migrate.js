const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
require('dotenv').config({path:path.resolve(__dirname,'../.env')});
const pool=require('../src/db');
async function main() {
 const files=fs.readdirSync(path.resolve(__dirname,'../migrations')).filter(x=>/^\d+.*\.sql$/.test(x)).sort();
 if(!process.argv.includes('--apply')){console.log('Migration plan only (no database writes):\n'+files.join('\n'));return;}
 const client=await pool.connect();
 try {
  await client.query('SELECT pg_advisory_lock(173824,1)');
  await client.query('CREATE TABLE IF NOT EXISTS tratum_schema_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  for(const file of files){
   const sql=fs.readFileSync(path.resolve(__dirname,'../migrations',file),'utf8'),hash=crypto.createHash('sha256').update(sql).digest('hex');
   const prior=await client.query('SELECT sha256 FROM tratum_schema_migrations WHERE name=$1',[file]);
   if(prior.rowCount){if(prior.rows[0].sha256!==hash)throw new Error('MIGRATION_CHECKSUM_CHANGED: '+file);continue;}
   await client.query('BEGIN');
   try {await client.query(sql);await client.query('INSERT INTO tratum_schema_migrations(name,sha256) VALUES($1,$2)',[file,hash]);await client.query('COMMIT');console.log('Applied '+file);}
   catch(error){await client.query('ROLLBACK');throw error;}
  }
 }finally{await client.query('SELECT pg_advisory_unlock(173824,1)').catch(()=>{});client.release();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>pool.end());
