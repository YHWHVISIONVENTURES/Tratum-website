const WebSocket = require('ws');

const {
  getLatestAnalyticsSnapshot
} = require('./analyticsSnapshotReader');

const {
  getTreasuryPressureState
} = require('./treasuryPressureEngine');

const {
  getRevenueVelocityState
} = require('./revenueVelocityEngine');

const {
  getNodeHealthState
} = require('./nodeHealthAnalytics');

const {
  getCorridorFlowState
} = require('./corridorFlowEngine');

// ======================================================
// GLOBAL WS STATE
// ======================================================

let wss = null;

const channels = {
  OPS: new Set(),
  TREASURY: new Set(),
  SECURITY: new Set(),
  INSTITUTION: new Set(),
  NODES: new Set()
};

// ======================================================
// SAFE JSON
// ======================================================

function send(ws, payload) {

  if (
    ws.readyState === WebSocket.OPEN
  ) {
    ws.send(
      JSON.stringify(payload)
    );
  }
}

// ======================================================
// REGISTER CLIENT
// ======================================================

function registerClient(ws, role) {

  if (!channels[role]) {
    return;
  }

  channels[role].add(ws);

  ws.on('close', () => {
    channels[role].delete(ws);
  });
}

// ======================================================
// ROLE ROUTING
// ======================================================

function resolveRole(roleCode) {

  switch(roleCode) {

    case 'SUPER_ADMIN':
      return 'OPS';

    case 'TREASURY_ADMIN':
      return 'TREASURY';

    case 'SECURITY_ADMIN':
      return 'SECURITY';

    case 'NODE_ADMIN':
      return 'NODES';

    case 'INSTITUTION':
      return 'INSTITUTION';

    default:
      return 'OPS';
  }
}

// ======================================================
// BUILD LIVE PAYLOAD
// ======================================================

async function buildPayload() {

  const [
    analytics,
    treasury,
    revenue,
    nodes,
    corridors
  ] = await Promise.all([

    getLatestAnalyticsSnapshot(),

    getTreasuryPressureState(),

    getRevenueVelocityState(),

    getNodeHealthState(),

    getCorridorFlowState()
  ]);

  return {

    timestamp:
      Date.now(),

    analytics,

    treasury,

    revenue,

    nodes,

    corridors
  };
}

// ======================================================
// BROADCAST LOOP
// ======================================================

async function broadcastLoop() {

  try {

    const payload =
      await buildPayload();

    // ------------------------------------------
    // OPS
    // ------------------------------------------

    for (const ws of channels.OPS) {

      send(ws, {
        type: 'OPS_METRICS',
        payload
      });
    }

    // ------------------------------------------
    // TREASURY
    // ------------------------------------------

    for (const ws of channels.TREASURY) {

      send(ws, {
        type: 'TREASURY_PRESSURE',
        payload: {
          treasury:
            payload.treasury,

          corridors:
            payload.corridors,

          revenue:
            payload.revenue
        }
      });
    }

    // ------------------------------------------
    // SECURITY
    // ------------------------------------------

    for (const ws of channels.SECURITY) {

      send(ws, {
        type: 'SECURITY_STATE',
        payload: {
          nodes:
            payload.nodes,

          treasury:
            payload.treasury
        }
      });
    }

    // ------------------------------------------
    // NODE OPS
    // ------------------------------------------

    for (const ws of channels.NODES) {

      send(ws, {
        type: 'NODE_HEALTH',
        payload: {
          nodes:
            payload.nodes
        }
      });
    }

    // ------------------------------------------
    // INSTITUTION
    // ------------------------------------------

    for (const ws of channels.INSTITUTION) {

      send(ws, {
        type: 'INSTITUTION_METRICS',
        payload: {
          revenue:
            payload.revenue,

          corridors:
            payload.corridors,

          nodes:
            payload.nodes
        }
      });
    }

  } catch (err) {

    console.error(
      '[WEBSOCKET FEED ERROR]',
      err.message
    );
  }
}

// ======================================================
// INIT ENGINE
// ======================================================

function initWebsocketFeedEngine(server) {

  wss = new WebSocket.Server({
    server
  });

  console.log(
    '[WS] FEED ENGINE INITIALIZED'
  );

  wss.on(
    'connection',
    (ws, req) => {

      try {

        const role =
          req.headers['x-role'];

        const resolved =
          resolveRole(role);

        registerClient(
          ws,
          resolved
        );

        send(ws, {
          type: 'CONNECTED',
          role: resolved,
          timestamp: Date.now()
        });

      } catch (err) {

        console.error(
          '[WS AUTH ERROR]',
          err.message
        );

        ws.close();
      }
    }
  );

  // ------------------------------------------
  // LIVE FEED LOOP
  // ------------------------------------------

  setInterval(
    broadcastLoop,
    5000
  );
}

module.exports = {
  initWebsocketFeedEngine
};