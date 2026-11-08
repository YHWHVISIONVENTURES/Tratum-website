const BankRailAdapter=require('../adapters/bankRailAdapter');
const registry=new Map();
let loaded=false;
function identity(rail,country) {
 const code=typeof country==='string'?country:country?.country_code;
 if(typeof rail!=='string' || !/^[A-Z0-9_:-]{1,64}$/.test(rail) || typeof code!=='string' || !/^[A-Z]{2,3}$/.test(code)) throw new Error('INVALID_RAIL_REGISTRY_IDENTITY');
 return `${code}:${rail}`;
}
function registerRailAdapter(rail,country,adapter) {
 const key=identity(rail,country);
 if(!adapter || typeof adapter.sendTransfer!=='function') throw new Error('INVALID_RAIL_ADAPTER');
 if(registry.has(key)) throw new Error('RAIL_ADAPTER_ALREADY_REGISTERED');
 registry.set(key,adapter);return adapter;
}
function configureRailAdapters(configurations,environment=process.env) {
 if(!Array.isArray(configurations)) throw new Error('INVALID_RAIL_ADAPTER_CONFIGURATION');
 const pending=new Map();
 for(const config of configurations) {
  const key=identity(config.rail,config.country);
  if(registry.has(key) || pending.has(key) || config.kind!=='BANK_HTTP') throw new Error('UNSUPPORTED_OR_DUPLICATE_RAIL_ADAPTER');
  const url=new URL(config.endpoint);
  if(url.protocol!=='https:' || url.username || url.password || url.hash) throw new Error('RAIL_ENDPOINT_REQUIRES_HTTPS');
  const apiKey=environment[config.apiKeyEnv],secret=environment[config.secretEnv];
  if(!apiKey || !secret) throw new Error('RAIL_ADAPTER_CREDENTIALS_REQUIRED');
  pending.set(key,new BankRailAdapter({name:config.rail,endpoint:url.href,apiKey,secret}));
 }
 for(const [key,adapter] of pending)registry.set(key,adapter);
}
function getRailAdapter(rail,country) {
 if(!loaded) {const value=process.env.TRATUM_RAIL_ADAPTERS_JSON;if(value)configureRailAdapters(JSON.parse(value));loaded=true;}
 const adapter=registry.get(identity(rail,country));
 if(!adapter) throw new Error('RAIL_ADAPTER_NOT_CONFIGURED');
 return adapter;
}
module.exports={registerRailAdapter,configureRailAdapters,getRailAdapter};
