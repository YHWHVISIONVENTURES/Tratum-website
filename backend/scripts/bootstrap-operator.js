const path=require('node:path');
require('dotenv').config({path:path.resolve(__dirname,'../.env')});
const bcrypt=require('bcryptjs');
const pool=require('../src/db');
async function main(){
 const email=process.argv[2],password=process.env.TRATUM_BOOTSTRAP_PASSWORD;
 if(typeof email!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length<16) throw new Error('Provide an email and TRATUM_BOOTSTRAP_PASSWORD of at least 16 characters');
 const hash=await bcrypt.hash(password,12);delete process.env.TRATUM_BOOTSTRAP_PASSWORD;
 await pool.query("INSERT INTO admin_users(email,password_hash,full_name,role_code,status) VALUES($1,$2,$1,'TRATUM_OPERATOR','ACTIVE')",[email.toLowerCase(),hash]);
 console.log('Operator created. No existing user was overwritten.');
}
main().catch(()=>{console.error('Operator bootstrap failed; check schema and inputs.');process.exitCode=1;}).finally(()=>pool.end());
