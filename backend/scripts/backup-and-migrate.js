const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {Pool}=require('pg');
const envIndex=process.argv.indexOf('--env-file'),backupIndex=process.argv.indexOf('--backup');
if(envIndex<0 || backupIndex<0)throw new Error('Provide --env-file and an absolute --backup path');
const envFile=path.resolve(process.argv[envIndex+1]),backup=path.resolve(process.argv[backupIndex+1]);
const config=require('dotenv').parse(fs.readFileSync(envFile));
const pool=new Pool({user:config.DB_USER,host:config.DB_HOST,database:config.DB_NAME,password:config.DB_PASSWORD,port:Number(config.DB_PORT||5432)});
async function main(){
 const client=await pool.connect();try{
  await client.query('BEGIN READ ONLY');
  for(const table of ['devices','device_registry','device_trust_state']){const r=await client.query(`SELECT count(*) FROM (SELECT lower(device_id) FROM ${table} GROUP BY lower(device_id) HAVING count(*)>1) conflicts`);if(Number(r.rows[0].count))throw new Error('Resolve duplicate canonical IDs in '+table+' before migrating');}
  const keys=await client.query('SELECT count(*) FROM (SELECT key FROM sync_state WHERE key IS NOT NULL GROUP BY key HAVING count(*)>1) conflicts');if(Number(keys.rows[0].count))throw new Error('Resolve duplicate sync_state keys before migrating');
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 if(fs.existsSync(backup))throw new Error('Backup destination already exists; choose a new file');
 fs.mkdirSync(path.dirname(backup),{recursive:true});
 const pgDir=process.env.TRATUM_PG_BIN || (process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin':'');
 const pgDump=pgDir?path.join(pgDir,process.platform==='win32'?'pg_dump.exe':'pg_dump'):'pg_dump';
 const pgRestore=pgDir?path.join(pgDir,process.platform==='win32'?'pg_restore.exe':'pg_restore'):'pg_restore';
 const env={...process.env,PGPASSWORD:String(config.DB_PASSWORD||'')};
 execFileSync(pgDump,['--format=custom','--file',backup,'--host',config.DB_HOST||'127.0.0.1','--port',String(config.DB_PORT||5432),'--username',config.DB_USER,'--dbname',config.DB_NAME],{env,stdio:'pipe'});
 execFileSync(pgRestore,['--list',backup],{env,stdio:'pipe'});
 const hash=crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
 console.log(JSON.stringify({backup_created:true,backup_path:backup,sha256:hash,bytes:fs.statSync(backup).size}));
 execFileSync(process.execPath,[path.join(__dirname,'migrate.js'),'--apply'],{env:{...process.env,...config},stdio:'inherit'});
 console.log('Existing platform migration completed; no financial job was started.');
}
main().catch(e=>{console.error('Migration stopped:',e.message);process.exitCode=1;}).finally(()=>pool.end());
