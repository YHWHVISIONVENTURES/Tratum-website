const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const analytics = require('../analytics/analyticsEngine');

// Read the existing live analytics implementations; no replacement calculations.
const getLatestAnalyticsSnapshot = async () => {
  await analytics.refreshAll();
  return analytics.getSnapshot();
};
const getTreasuryPressureState = analytics.computeTreasuryPressure.bind(analytics);
const getRevenueVelocityState = analytics.computeRevenueMetrics.bind(analytics);
const getNodeHealthState = analytics.computeNodeMetrics.bind(analytics);
const getCorridorFlowState = analytics.computeCorridorMetrics.bind(analytics);

// ======================================================
// GLOBAL WS STATE
// ======================================================

let wss = null;
let broadcastTimer = null;

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
      return null;
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

  if (wss) return;
  wss = new WebSocket.Server({
    server,
    verifyClient(info, done) {
      try {
        const auth = info.req.headers.authorization;
        if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return done(false, 401);
        const claims = jwt.verify(auth.slice(7), process.env.ADMIN_JWT_SECRET);
        const role = resolveRole(claims.role);
        const permissions = { OPS: 'OPS_VIEW', TREASURY: 'TREASURY_VIEW', SECURITY: 'SECURITY_VIEW', NODES: 'NODES_VIEW' };
        if (!role || !permissions[role] || !Array.isArray(claims.permissions) || !claims.permissions.includes(permissions[role])) return done(false, 403);
        info.req.feedRole = role;
        info.req.feedExpiry = claims.exp;
        return done(true);
      } catch { return done(false, 401); }
    }
  });

  console.log(
    '[WS] FEED ENGINE INITIALIZED'
  );

  wss.on(
    'connection',
    (ws, req) => {

      try {

        const resolved = req.feedRole;
        const remaining = Math.max(0, req.feedExpiry * 1000 - Date.now());
        const expiry = setTimeout(() => ws.close(1008, 'Session expired'), Math.min(remaining, 2147483647));
        ws.on('close', () => clearTimeout(expiry));

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

  broadcastTimer = setInterval(
    broadcastLoop,
    5000
  );
}

function shutdown() {
  clearInterval(broadcastTimer); broadcastTimer = null;
  if (wss) { for (const ws of wss.clients) ws.terminate(); wss.close(); wss = null; }
  for (const set of Object.values(channels)) set.clear();
}
module.exports = { initWebsocketFeedEngine, initialize: initWebsocketFeedEngine, shutdown };