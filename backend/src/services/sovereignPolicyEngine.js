const pool = require('../db');

const {
  resolveCountryConfig
} = require('./countryResolutionEngine');

async function validateSovereignPolicy({

  sovereign_id,
  asset,
  from_country,
  to_country,
  amount

}) {

  const result = await pool.query(
    `
    SELECT *
    FROM sovereign_policy
    WHERE sovereign_id=$1
    AND policy_status='ACTIVE'
    LIMIT 1
    `,
    [sovereign_id]
  );

  if (!result.rows.length) {
    return {
      status: 'NO_POLICY'
    };
  }

  const policy =
    result.rows[0];

  if (
    Number(amount) >
    Number(policy.max_single_transfer)
  ) {
    throw new Error(
      'SOVEREIGN_TRANSFER_LIMIT_EXCEEDED'
    );
  }

  if (
    policy.blocked_corridors?.includes(
      `${from_country}_${to_country}`
    )
  ) {
    throw new Error(
      'CORRIDOR_BLOCKED'
    );
  }

  if (
    policy.restricted_assets?.includes(
      asset
    )
  ) {
    throw new Error(
      'ASSET_RESTRICTED'
    );
  }

  return {
    status: 'POLICY_VALID'
  };
}

async function enforcePolicy({
  country_code,
  asset_type, // 'CBDC', 'STABLECOIN', 'FIAT'
  is_fx = false,
  is_offline = false,
  client = null
}) {

  // ======================================================
  // 🛡️ SOVEREIGN CONFIG DISCOVERY (WIRING)
  // ======================================================
  const sovereignConfig = await resolveCountryConfig(
    country_code,
    client
  );

  // 1. OFFLINE ENFORCEMENT
  if (is_offline && !sovereignConfig.offline_enabled) {
    throw new Error('OFFLINE_MODE_DISABLED_BY_SOVEREIGN');
  }

  // 2. FX ENFORCEMENT
  if (is_fx && !sovereignConfig.fx_enabled) {
    throw new Error('FX_OPERATIONS_DISABLED_BY_SOVEREIGN');
  }

  // 3. ASSET TYPE ENFORCEMENT
  if (asset_type === 'CBDC' && !sovereignConfig.cbdc_enabled) {
    throw new Error('CBDC_RAILS_DISABLED_BY_SOVEREIGN');
  }

  // 4. SETTLEMENT MODE VALIDATION
  // Example: If the country only allows 'GROSS' but we are trying 'NET'
  if (sovereignConfig.settlement_mode === 'STRICT_GROSS' && is_offline) {
    throw new Error('DEFERRED_SETTLEMENT_NOT_ALLOWED_IN_GROSS_JURISDICTION');
  }

  return {
    status: 'POLICY_ENFORCED',
    config: sovereignConfig
  };
}


module.exports = {
  validateSovereignPolicy,
  enforcePolicy // Exporting the enforcement function for use in routing and settlement engines
};