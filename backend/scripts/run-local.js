const path=require('node:path');
const fs=require('node:fs');
const index=process.argv.indexOf('--env-file');
const envFile=index>=0?path.resolve(process.argv[index+1] || ''):path.resolve(__dirname,'../.env');
if(!fs.existsSync(envFile))throw new Error('Provide the existing configuration with --env-file');
require('dotenv').config({path:envFile,quiet:true});
process.env.PORT='3000';process.env.TRATUM_BIND_HOST='127.0.0.1';process.env.NODE_ENV='development';
process.env.PORTAL_ORIGIN='http://localhost:3000';
process.env.ADMIN_UI_ORIGIN=[process.env.ADMIN_UI_ORIGIN,'http://localhost:3000','http://127.0.0.1:3000'].filter(Boolean).join(',');
const keyDirectory=path.join(path.dirname(envFile),'keys');
for(const [flag,name] of [['--ca-key-file','TRATUM_ROOT_CA_PRIVATE_KEY_PATH'],['--ca-public-file','TRATUM_ROOT_CA_CERTIFICATE_PATH']]){const i=process.argv.indexOf(flag);if(i>=0)process.env[name]=path.resolve(process.argv[i+1] || '');}
for(const [name,file] of [['TRATUM_ROOT_CA_PRIVATE_KEY_PATH','root_private.pem'],['TRATUM_ROOT_CA_CERTIFICATE_PATH','root_public.pem']]){
 if(!process.env[name]&&fs.existsSync(path.join(keyDirectory,file)))process.env[name]=path.join(keyDirectory,file);
}
require('../src/admin-app').start().catch(async error=>{console.error('Local startup failed:',error.message);await require('../src/db').end();process.exitCode=1;});
