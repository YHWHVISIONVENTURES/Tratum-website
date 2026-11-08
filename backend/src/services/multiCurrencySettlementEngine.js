// ==========================================================
// FILE: /services/multiCurrencySettlementEngine.js
// ==========================================================

const crypto = require('crypto');

const {
  resolveRate
} = require('./fxOracle');

const {
  resolveRoute
} = require('./routingEngine');

const {
  registerFinality
} = require('./routeFinalityEngine');

const {
  releaseLiquidityLock
} = require('./treasuryLocksEngine');

const {

  resolveCountryConfig,
  resolveTreasuryPool,
  resolveCountryRails

} = require('./countryResolutionEngine');

const { reserveLiquidity } = require('../engines/treasuryPoolEngine');

// ----------------------------------------------------------
// HELPERS
// ----------------------------------------------------------
function buildSettlementReference() {

  return crypto
    .randomBytes(18)
    .toString('hex');
}

// ----------------------------------------------------------
// MULTI-CURRENCY ROUTER
// ----------------------------------------------------------
async function buildSettlementPlan({

  from_country,

  to_country,

  from_currency,

  to_currency,

  amount,
  client = null

}) {

  const route =
    await resolveRoute({

      from_country,
      to_country,
      asset: to_currency,
      client
    });

    // ======================================================
// SOVEREIGN CONFIG
// ======================================================

const sourceCountry =
  await resolveCountryConfig(
    from_country,
    client
  );

const destinationCountry =
  await resolveCountryConfig(
    to_country,
    client
  );

// ======================================================
// TREASURY POOLS
// ======================================================

const sourceTreasury =
  await resolveTreasuryPool({

    country_code:
      from_country,

    currency_code:
      source_currency,

    client
  });

const destinationTreasury =
  await resolveTreasuryPool({

    country_code:
      to_country,

    currency_code:
      destination_currency,

    client
  });

// ======================================================
// COUNTRY RAILS
// ======================================================

const sourceRails =
  await resolveCountryRails({

    country_code:
      from_country,

    client
  });

const destinationRails =
  await resolveCountryRails({

    country_code:
      to_country,

    client
  });

  const fx =
    await resolveRate(
      from_currency,
      to_currency
    );

  const settledAmount =
    Number(amount) * Number(fx);

  return {

    route,

    fx_rate: fx,

    settlement_amount:
      settledAmount,

    settlement_currency:
      to_currency,

    // 🛡️ ENRICHED DATA FOR THE UI/WORKER
    source_config: sourceCountry,
    destination_config: destinationCountry,
    source_pool_account: sourceTreasury.account_code,
    destination_pool_account: destinationTreasury.account_code,
    available_rails: destinationRails,

    fx_source: 'fxOracle',
    created_at: Date.now()

  };
}

// ----------------------------------------------------------
// CREATE SETTLEMENT TRACKER
// ----------------------------------------------------------
async function createSettlementFinality({

  route,

  operation,

  source_reference,
  client

}) {

  const reference =
    buildSettlementReference();

    await reserveLiquidity({
    route_id: route.route_id,
    
    source_pool: route.source_pool,
    destination_pool: route.destination_pool,
    
    source_currency: route.source_currency,
    destination_currency: route.destination_currency,
    
    source_amount: route.source_amount,
    destination_amount: route.destination_amount,
    
    // Wire these from the new jurisdictional columns
    source_country: route.source_country,
    destination_country: route.destination_country,
    
    economic_event_id: route.economic_event_id,
    reference: reference, // Tie the lock to this settlement reference
    client
});

  // ----------------------------------------------------
  // REGISTER FINALITY (The Ledger Trace)
  // ----------------------------------------------------
  await registerFinality({
    reference,
    rail_type: route.rail.rail,
    operation,
    route,
    required_confirmations: route.rail.rail === 'CBDC' ? 1 : 3,
    source_reference,
    client, // 🛡️ KEEP ATOMIC
    metadata: {
      created_by: 'multiCurrencySettlementEngine',
      economic_event_id: route.economic_event_id
    }
  });

  return reference;
}

// ----------------------------------------------------------
// FINALIZE MULTI-CURRENCY SETTLEMENT
// ----------------------------------------------------------
async function finalizeSettlement({

  settlement_reference,

  partner_id,

  corridor_id,

  economic_event_id,

  settlement_currency,

  settlement_amount,

  route,

  client

}) {

  // ======================================================
  // MARK FINALITY COMPLETE
  // ======================================================

  await confirm(
    settlement_reference
  );

  // ======================================================
  // RELEASE TREASURY LOCK
  // ======================================================

  await releaseLiquidityLock({

    reference:
      settlement_reference,

    client
  });

  // ======================================================
  // CORRIDOR PARTNER PAYOUT
  // ======================================================

  await queuePayout({

    actor_id:
      partner_id,

    actor_type:
      'CORRIDOR_PARTNER',

    payout_type:
      'CORRIDOR_SETTLEMENT',

    source_type:
      'MULTI_CURRENCY_SETTLEMENT',

    source_reference:
      settlement_reference,

    economic_event_id,

    currency_code:
      settlement_currency,

    amount:
      settlement_amount,

    metadata: {

      corridor_id,

      rail:
        route.rail,

      settlement_reference
    },

    client
  });

  return {
    status: 'SETTLED',
    settlement_reference
  };
}

module.exports = {
  buildSettlementPlan,
  createSettlementFinality,
  finalizeSettlement
};