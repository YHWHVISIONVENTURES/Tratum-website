const path = require('path');
const fs = require('node:fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const pool = require('./db');

const app = express();

const allowedOrigins = [process.env.ADMIN_UI_ORIGIN || 'http://localhost:5173', process.env.PORTAL_ORIGIN || ''].join(',')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS_ORIGIN_DENIED'));
  }
}));
app.use(express.json({ limit: '32kb' }));
app.use(require('./routes/runtimeRoutes'));
app.use(require('./routes/deviceFeatureRoutes'));
app.use(require('./routes/deviceDeltaRoutes'));
app.use(require('./routes/institutionPortalRoutes'));
app.use(require('./routes/deviceLifecycleRoutes'));
app.use(require('./routes/commandCenterRoutes'));
app.use(require('./routes/webhookRoutes'));

app.use('/admin/v1/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'TOO_MANY_LOGIN_ATTEMPTS' }
}));

app.use('/admin', require('./routes/adminInstitutionRoutes'));
app.use(require('./routes/adminAuthRoutes'));
app.use(require('./routes/adminDashboardRoutes'));
app.use(require('./routes/deviceIntakeRoutes'));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    return res.status(503).json({ status: 'unavailable', database: 'disconnected' });
  }
});
app.get('/',(req,res)=>res.redirect('/admin/network'));

const uiDirectory=path.resolve(__dirname,'../admin-ui/dist');
if(fs.existsSync(path.join(uiDirectory,'index.html'))) {
  app.use(express.static(uiDirectory,{index:false}));
  app.get(['/bank','/institution','/enterprise','/central-bank','/login','/admin','/admin/network','/admin/runtime','/admin/ops','/admin/treasury','/admin/nodes','/admin/institutions','/admin/security','/admin/billing','/admin/logs','/admin/device-intakes'],(req,res)=>{
    res.set('Cache-Control','no-store');res.sendFile(path.join(uiDirectory,'index.html'));
  });
}

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.message === 'CORS_ORIGIN_DENIED' ? 403 : error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : 500;
  return res.status(status).json({ ok: false, error: status === 403 ? 'ORIGIN_NOT_ALLOWED' : status === 400 ? 'INVALID_JSON' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_SERVER_ERROR' });
});

const port = Number(process.env.PORT || 3000);

async function start() {
  if (!process.env.ADMIN_JWT_SECRET) {
    throw new Error('ADMIN_JWT_SECRET is required');
  }
  await pool.query('SELECT 1');
  const bindHost=process.env.TRATUM_BIND_HOST || '127.0.0.1';
  const server=await new Promise((resolve,reject)=>{
    const candidate=app.listen(port,bindHost,()=>resolve(candidate));candidate.once('error',reject);
  });
  console.log(`[TRATUM CONTROL PLANE] Listening on http://${bindHost}:${port}`);
  const {observe}=require('./services/workerObservation');
  let checking=false;
  async function check(){if(checking)return;checking=true;await observe('control-plane-health','started');try{await pool.query('SELECT 1');await observe('control-plane-health','completed');}catch{await observe('control-plane-health','failed');}finally{checking=false;}}
  await check();
  const heartbeat=setInterval(check,15000);
  server.once('close',()=>clearInterval(heartbeat));

  async function shutdown() {
    clearInterval(heartbeat);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

module.exports = { app, start };

if (require.main === module) start().catch(async (error) => {
  console.error('[TRATUM ADMIN API] Startup failed:', error.message);
  await pool.end();
  process.exit(1);
});
