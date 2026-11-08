const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const pool = require('./db');

const app = express();

const allowedOrigins = (process.env.ADMIN_UI_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS_ORIGIN_DENIED'));
  }
}));
app.use(express.json({ limit: '32kb' }));
app.use(require('./routes/runtimeRoutes'));
app.use(require('./routes/bankSessionRoutes'));
app.use(require('./routes/deviceFeatureRoutes'));

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

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.message === 'CORS_ORIGIN_DENIED' ? 403 : 500;
  return res.status(status).json({ ok: false, error: status === 403 ? 'ORIGIN_NOT_ALLOWED' : 'INTERNAL_SERVER_ERROR' });
});

const port = Number(process.env.PORT || 3000);

async function start() {
  if (!process.env.ADMIN_JWT_SECRET) {
    throw new Error('ADMIN_JWT_SECRET is required');
  }
  await pool.query('SELECT 1');
  const server = app.listen(port, () => {
    console.log(`[TRATUM ADMIN API] Listening on ${port}`);
  });

  async function shutdown() {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

start().catch(async (error) => {
  console.error('[TRATUM ADMIN API] Startup failed:', error.message);
  await pool.end();
  process.exit(1);
});

