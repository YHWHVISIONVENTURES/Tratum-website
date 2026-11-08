const path=require('node:path');
require('dotenv').config({path:path.resolve(__dirname,'../../.env')});
const {cycle,validateConfiguration}=require('../services/webhookDelivery');
const {observe}=require('../services/workerObservation');
const pool=require('../db');
let stopped=false;
process.once('SIGINT',()=>{stopped=true;});process.once('SIGTERM',()=>{stopped=true;});
async function run() {
 validateConfiguration();
 while(!stopped) {
  await observe('webhook-delivery','started');
  try {await cycle();await observe('webhook-delivery','completed');}
  catch {await observe('webhook-delivery','failed');}
  if(!stopped)await new Promise(resolve=>setTimeout(resolve,1000));
 }
 await pool.end();
}
if(require.main===module)run().catch(async()=>{console.error('[WEBHOOK WORKER] startup failed; verify configuration');await pool.end();process.exitCode=1;});
module.exports={run};
