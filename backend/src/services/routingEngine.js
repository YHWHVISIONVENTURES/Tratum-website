const crypto = require('crypto');
const { validateSovereignPolicy } = require('./sovereignPolicyEngine');

const {
  resolveRate
} = require('./fxOracle');

const {
  checkTreasuryLiquidity,
  reserveLiquidity
} = require('../engines/treasuryPoolEngine');

const {
  resolveRail
} = require('./railResolver');

const {
  resolveCountryRails
} = require('./countryResolutionEngine');

// -------------------------------------
// HELPERS
// -------------------------------------
function buildRouteId(payload) {

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

// -------------------------------------
// GET CORRIDOR RULE
// -------------------------------------
async function getCorridor(
  fromCountry,
  toCountry,
  client
) {

  const result = await client.query(
    `
    SELECT *
    FROM settlement_corridors
    WHERE from_country=$1
    AND to_country=$2
    AND active=true
    LIMIT 1
    `,
    [fromCountry, toCountry]
  );

  return result.rows[0] || null;
}

// -------------------------------------
// DEFAULT ROUTE
// -------------------------------------
function fallbackRoute() {

  return {
    preferred_asset: 'USDT',
    preferred_rail: 'STABLECOIN',
    cost_score: 1,
    latency_score: 1
  };
}

// -------------------------------------
// CORE ROUTER
// -------------------------------------
async function resolveRoute({

  source_country,
  destination_country,

  source_currency,
  destination_currency,

  source_amount,

  sender_id,
  receiver_id,

  online_state = 'ONLINE',

  preferred_rail = null,

  economic_event_id,

  client

}) {

  // -------------------------------------
  // VALIDATION
  // -------------------------------------
  if (!economic_event_id) {
    throw new Error('MISSING_ECONOMIC_EVENT');
  }

  if (!source_currency) {
    throw new Error('MISSING_SOURCE_CURRENCY');
  }

  if (!destination_currency) {
    throw new Error('MISSING_DESTINATION_CURRENCY');
  }

  // =====================================================
  // ⚖️ SOVEREIGN POLICY: INJECT HERE
  // =====================================================
  // Ensure the project-wide policy is imported from sovereignPolicyEngine
  await validateSovereignPolicy({
    sovereign_id: 'TRATUM_CENTRAL_AUTH', // The master authority ID
    asset: source_currency,
    from_country: source_country,
    to_country: destination_country,
    amount: source_amount
  });

  // -------------------------------------
  // CORRIDOR
  // -------------------------------------
  const corridor =
    await getCorridor(
      source_country,
      destination_country,
      client
    );

    // ======================================================
// COUNTRY RAIL DISCOVERY
// ======================================================

const sourceRails =
  await resolveCountryRails({
    country_code: source_country, client
  });

const destinationRails =
  await resolveCountryRails({
    country_code: destination_country, client
  });

  let route =
  corridor || fallbackRoute();

// -------------------------------------
// HEALTH ENFORCEMENT
// -------------------------------------
if (
  corridor &&
  Number(corridor.health_score || 0) < 40
) {

  route = fallbackRoute();
}

  // -------------------------------------
  // FX RESOLUTION
  // -------------------------------------
  const fx_rate =
    await resolveRate(
      source_currency,
      destination_currency
    );

  const destination_amount =
    Number(
      (
        Number(source_amount) *
        Number(fx_rate)
      ).toFixed(2)
    );

  // -------------------------------------
  // TREASURY CHECK
  // -------------------------------------
  const liquidity =
    await checkTreasuryLiquidity({

      source_currency,
      destination_currency,

      source_amount,
      destination_amount,

      source_country,
      destination_country,

      client
    });

  if (!liquidity.ok) {
    throw new Error('INSUFFICIENT_LIQUIDITY');
  }

  // -------------------------------------
  // RAIL RESOLUTION
  // -------------------------------------
  const rail =
    await resolveRail({

      preferred_rail,

      corridor: route,
      sourceRails,
      destinationRails,

      online_state,

      source_currency,
      destination_currency,

      amount: source_amount,

      liquidity_health:
        liquidity.health_score
    });

  // -------------------------------------
  // ROUTE ID
  // -------------------------------------
  const route_id =
    buildRouteId({

      economic_event_id,

      source_country,
      destination_country,

      source_currency,
      destination_currency,

      source_amount,

      sender_id,
      receiver_id,

      rail
    });

  // -------------------------------------
  // LIQUIDITY LOCK
  // -------------------------------------
  const liquidity_lock =
    await reserveLiquidity({

      route_id,

      source_pool:
        liquidity.source_pool,

      destination_pool:
        liquidity.destination_pool,

      source_currency,
      destination_currency,

      source_amount,
      destination_amount,

      economic_event_id,

      client
    });

    // ======================================================
// DYNAMIC RAIL RESOLUTION
// ======================================================

const selectedRail = rail.rail_code;

  // -------------------------------------
  // ROUTE OBJECT
  // -------------------------------------
  return {

    route_id,

    rail: selectedRail,
    asset:
      route.preferred_asset,

    source_country,
    destination_country,

    source_currency,
    destination_currency,

    source_amount,
    destination_amount,

    fx_rate,

    source_pool:
      liquidity.source_pool,

    destination_pool:
      liquidity.destination_pool,

    liquidity_lock_id:
      liquidity_lock.lock_id,

    liquidity_reserved: true,

    settlement_mode:
      rail.settlement_mode,

    estimated_finality:
      rail.estimated_finality,

    economic_event_id
  };
}

module.exports = {
  resolveRoute
};
