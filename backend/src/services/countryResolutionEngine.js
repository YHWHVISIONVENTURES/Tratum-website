// ==========================================================
// FILE: /services/countryResolutionEngine.js
// TRATUM — SOVEREIGN RESOLUTION ENGINE
// ==========================================================

const pool = require('../db');

// ==========================================================
// COUNTRY CONFIG
// ==========================================================
async function resolveCountryConfig(
  country_code,
  externalClient = null
) {

  if (!country_code) {
    throw new Error('COUNTRY_REQUIRED');
  }

  const db =
    externalClient || pool;

  const result = await db.query(
    `
    SELECT *
    FROM country_configs
    WHERE country_code=$1
    AND active=true
    LIMIT 1
    `,
    [country_code]
  );

  if (!result.rows.length) {
    throw new Error('COUNTRY_CONFIG_NOT_FOUND');
  }

  return result.rows[0];
}

// ==========================================================
// TREASURY POOL
// ==========================================================
async function resolveTreasuryPool({
  country_code,
  currency_code,
  client: externalClient = null
}) {

  const db =
    externalClient || pool;

  const result = await db.query(
    `
    SELECT *
    FROM sovereign_treasury_pools
    WHERE country_code=$1
    AND currency_code=$2
    AND active=true
    LIMIT 1
    `,
    [
      country_code,
      currency_code
    ]
  );

  if (!result.rows.length) {
    throw new Error('TREASURY_POOL_NOT_FOUND');
  }

  return result.rows[0];
}

// ==========================================================
// COUNTRY RAILS
// ==========================================================
async function resolveCountryRails({
  country_code,
  rail_type = null,
  client: externalClient = null
}) {

  const db =
    externalClient || pool;

  let query = `
    SELECT *
    FROM sovereign_rail_adapters
    WHERE country_code=$1
    AND active=true
  `;

  const params = [country_code];

  if (rail_type) {

    query += `
      AND rail_type=$2
    `;

    params.push(rail_type);
  }

  query += `
    ORDER BY priority_score DESC
  `;

  const result =
    await db.query(
      query,
      params
    );

  return result.rows;
}

// ==========================================================
// KYC RULES
// ==========================================================
async function resolveKycRules({
  country_code,
  tier_name,
  client: externalClient = null
}) {

  const db =
    externalClient || pool;

  const result = await db.query(
    `
    SELECT *
    FROM sovereign_kyc_rules
    WHERE country_code=$1
    AND tier_name=$2
    AND active=true
    LIMIT 1
    `,
    [
      country_code,
      tier_name
    ]
  );

  if (!result.rows.length) {
    throw new Error('KYC_RULE_NOT_FOUND');
  }

  return result.rows[0];
}

// ==========================================================
// TAX PROFILE
// ==========================================================
async function resolveTaxProfile(
  country_code,
  externalClient = null
) {

  const db =
    externalClient || pool;

  const result = await db.query(
    `
    SELECT *
    FROM sovereign_tax_profiles
    WHERE country_code=$1
    AND active=true
    LIMIT 1
    `,
    [country_code]
  );

  if (!result.rows.length) {
    throw new Error('TAX_PROFILE_NOT_FOUND');
  }

  return result.rows[0];
}

// ==========================================================
// SOVEREIGN INTEGRATION
// ==========================================================
async function resolveSovereignIntegration({
  country_code,
  integration_type,
  client: externalClient = null
}) {

  const db =
    externalClient || pool;

  const result = await db.query(
    `
    SELECT *
    FROM sovereign_integrations
    WHERE country_code=$1
    AND integration_type=$2
    AND active=true
    LIMIT 1
    `,
    [
      country_code,
      integration_type
    ]
  );

  if (!result.rows.length) {
    throw new Error(
      'SOVEREIGN_INTEGRATION_NOT_FOUND'
    );
  }

  return result.rows[0];
}

module.exports = {

  resolveCountryConfig,

  resolveTreasuryPool,

  resolveCountryRails,

  resolveKycRules,

  resolveTaxProfile,

  resolveSovereignIntegration
};