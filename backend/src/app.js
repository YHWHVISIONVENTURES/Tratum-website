// =======================================================
// FILE: src/app.js
// CLEANED + SOVEREIGN OBSERVABILITY READY
// =======================================================

const path = require('path');

const dotenv = require('dotenv');

const express = require('express');

const cors = require('cors');

const http = require('http');

// =======================================================
// ENVIRONMENT
// =======================================================

dotenv.config({
  path: path.resolve(__dirname, '../.env')
});

// =======================================================
// CORE
// =======================================================

const pool = require('./db');

const systemInit =
require('./bootstrap/systemInit');

// =======================================================
// REALTIME STATE ENGINE
// =======================================================

const realtimeStateEngine =
require('./services/realtimeStateEngine');

// =======================================================
// ROUTES
// =======================================================

const syncRoutes =
require('./routes/syncRoutes');

const institutionRoutes =
require('./routes/institutionRoutes');

const adminInstitutionRoutes =
require('./routes/adminInstitutionRoutes');

const nodeValueRoutes =
require('./routes/nodeValueRoutes');

const deviceRoutes =
require('./routes/deviceRoutes');

const cbdcRoutes =
require('./routes/cbdcRoutes');

const fiatRoutes =
require('./routes/fiatRoutes');

const sovereignRoutes =
require('./routes/sovereignRoutes');

const sovereignBurnRoutes =
require('./routes/sovereignBurnRoutes');

const railGatewayRoutes =
require('./routes/railGatewayRoutes');

const sovereignAuditRoutes =
require('./routes/sovereignAuditRoutes');

const deviceCertRoutes =
require('./routes/deviceCertificateRoutes');

const discoveryRoutes =
require('./routes/discoveryRoutes');

const systemHealthRoutes =
require('./routes/systemHealthRoutes');

const balanceSheetRoutes =
require('./routes/balanceSheetRoutes');

const reconciliationRoutes =
require('./routes/reconciliationRoutes');

const interbankRoutes =
require('./routes/interbankRoutes');

const merchantRoutes =
require('./routes/merchantRoutes');

const revenueRoutes =
require('./routes/revenueRoutes');

const deviceAttestationRoutes =
require('./routes/deviceAttestationRoutes');

const adminDashboardRoutes =
require('./routes/adminDashboardRoutes');

const adminAuthRoutes =
require('./routes/adminAuthRoutes');

const portalDashboardRoutes =
require('./routes/portalDashboardRoutes');

// =======================================================
// EXPRESS
// =======================================================

const app = express();


const server =
http.createServer(app);

// =======================================================
// MIDDLEWARE
// =======================================================

app.use(cors());

app.use(express.json({ limit: '32kb' }));
app.use(require('./routes/runtimeRoutes'));
app.use(require('./routes/bankSessionRoutes'));
app.use(require('./routes/deviceFeatureRoutes'));

// =======================================================
// ROUTES
// =======================================================

app.use(syncRoutes);

app.use(deviceRoutes);

app.use(institutionRoutes);

app.use('/admin',
  adminInstitutionRoutes
);

app.use('/admin/v1',
  nodeValueRoutes
);

app.use(railGatewayRoutes);

app.use(cbdcRoutes);

app.use(fiatRoutes);

app.use(sovereignRoutes);

app.use(sovereignBurnRoutes);

app.use(sovereignAuditRoutes);

app.use(deviceAttestationRoutes);

app.use(discoveryRoutes);

app.use(systemHealthRoutes);

app.use(balanceSheetRoutes);

app.use(reconciliationRoutes);

app.use(interbankRoutes);

app.use(merchantRoutes);

app.use(revenueRoutes);

app.use(deviceCertRoutes);

app.use(adminDashboardRoutes);

app.use(adminAuthRoutes);

app.use(portalDashboardRoutes);
app.use(require('./routes/webhookRoutes'));

app.use(
  '/api/device/v1/p2p',
  require('./routes/p2pRoutes')
);

// =======================================================
// HEALTH CHECK
// =======================================================

app.get('/health', async (req, res) => {

  try {

    const result =
      await pool.query('SELECT NOW()');

    return res.json({

      status: 'OK',

      database: 'CONNECTED',

      now: result.rows[0]

    });

  } catch (err) {

    return res.status(500).json({

      status: 'ERROR',

      database: 'DISCONNECTED',

      error: err.message

    });

  }
});

// =======================================================
// SOVEREIGN BOOT SEQUENCE
// =======================================================

async function boot() {

  try {

    console.log(
      '[TRATUM] Starting Sovereign Estate...'
    );

    // ---------------------------------------------------
    // DATABASE VALIDATION
    // ---------------------------------------------------

    await pool.query('SELECT NOW()');

    console.log(
      '✅ PostgreSQL connected'
    );

    // ---------------------------------------------------
    // INITIALIZE CORE SYSTEM
    // ---------------------------------------------------

    await systemInit();

    // ---------------------------------------------------
    // INITIALIZE REALTIME ENGINE
    // ---------------------------------------------------

    console.log(
      '[TRATUM] Initializing Realtime State Engine...'
    );

    await realtimeStateEngine
      .initialize(server);

    // ---------------------------------------------------
    // START API
    // ---------------------------------------------------

    const PORT =
      process.env.PORT || 3000;

    server.listen(PORT, () => {

      console.log(
        '\n[TRATUM] --- ESTATE ONLINE ---'
      );

      console.log(
        `[TRATUM] API listening on ${PORT}`
      );

      console.log(
        '[TRATUM] Sovereign telemetry active'
      );

      console.log(
        '[TRATUM] Realtime state propagation active'
      );

      console.log(
        '[TRATUM] Analytics snapshot pipeline active\n'
      );

    });

  } catch (err) {

    console.error(
      '\n❌ [FATAL_BOOT_FAILURE]'
    );

    console.error(
      err.message
    );

    process.exit(1);
  }
}

// =======================================================
// START SYSTEM
// =======================================================

boot();

