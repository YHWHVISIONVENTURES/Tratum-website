// ==========================================================
// FILE: /services/taxEngine.js
// TRATUM — BANK-GRADE TAX ENGINE
// NIGERIA 2026 VAT / WITHHOLDING MODEL
// ==========================================================

const crypto = require('crypto');
const pool = require('../db');
const {
  resolveTaxProfile
} = require('./countryResolutionEngine');
// ----------------------------------------------------------
// TAXABLE EVENT MATRIX
// ----------------------------------------------------------
const TAX_RULES = {

  // Merchant processing
  MERCHANT_PROCESSING_FEE: {
    vat: true,
    withholding: false
  },

  // Settlement usage
  SETTLEMENT_FEE: {
    vat: true,
    withholding: false
  },

  // Agent commissions
  AGENT_COMMISSION: {
    vat: true,
    withholding: true
  },

  // Device activation
  DEVICE_ACTIVATION: {
    vat: true,
    withholding: false
  },

  // Wallet transfers
  P2P_TRANSFER: {
    vat: false,
    withholding: false
  },

  // Principal movement
  VALUE_TRANSFER: {
    vat: false,
    withholding: false
  }
};

// ----------------------------------------------------------
// HELPERS
// ----------------------------------------------------------
function buildTaxEventId(
  economic_event_id,
  tax_type
) {
  return crypto
    .createHash('sha256')
    .update(
      `${economic_event_id}|${tax_type}`
    )
    .digest('hex');
}

function money(v) {

  const n = parseFloat(v);

  if (!Number.isFinite(n)) {
    throw new Error('INVALID_AMOUNT');
  }

  return n;
}

function pct(base, rate) {

  return Number(
    (
      base *
      (rate / 100)
    ).toFixed(2)
  );
}

// ----------------------------------------------------------
// LOAD TAX PROFILE
// ----------------------------------------------------------
async function getTaxProfile(
  institution_id,
  client
) {

  const r = await client.query(
    `
    SELECT *
    FROM tax_profiles
    WHERE institution_id=$1
    AND status='ACTIVE'
    LIMIT 1
    `,
    [institution_id]
  );

  if (!r.rows.length) {

    return {
      vat_enabled: true,
      withholding_enabled: false,
      vat_rate: 7.5,
      withholding_rate: 0,
      tax_region: 'NG'
    };
  }

  return r.rows[0];
}

// ----------------------------------------------------------
// APPLY TAX ENGINE
// ----------------------------------------------------------
async function applyTaxes({

  institution_id,
  economic_event_id,
  billing_ledger_id,
  transaction_id = null,
  fee_code,
  amount,
  currency_code = 'NGN',
  metadata = {},
  client: externalClient = null

}) {

  const client =
    externalClient ||
    await pool.connect();

  let ownsTx = false;

  try {

    if (!externalClient) {
      await client.query('BEGIN');
      ownsTx = true;
    }

    // ------------------------------------------------------
    // VALIDATION
    // ------------------------------------------------------
    if (!institution_id) {
      throw new Error('INVALID_INSTITUTION');
    }

    if (!economic_event_id) {
      throw new Error('MISSING_ECONOMIC_EVENT');
    }

    if (!metadata.country_code) {
  throw new Error(
    'COUNTRY_CODE_REQUIRED'
  );
}

    const value = money(amount);

    if (value <= 0) {
      throw new Error('INVALID_AMOUNT');
    }

    // ------------------------------------------------------
    // LOAD PROFILE
    // ------------------------------------------------------
    const profile =
  await resolveTaxProfile(
    metadata.country_code,
    client
  );

    // ------------------------------------------------------
    // RULE LOOKUP
    // ------------------------------------------------------
    const rule =
      TAX_RULES[fee_code];

    if (!rule) {

      if (ownsTx) {
        await client.query('COMMIT');
      }

      return {
        status: 'NON_TAXABLE'
      };
    }

    const results = [];

    // ======================================================
    // VAT
    // ======================================================
    if (
      rule.vat &&
      profile.vat_enabled
    ) {

      const vatAmount =
        pct(
          value,
          parseFloat(profile.vat_rate)
        );

      const taxEventId =
        buildTaxEventId(
          economic_event_id,
          'VAT'
        );

      await client.query(
        `
        INSERT INTO tax_transactions
        (
          tax_event_id,
          economic_event_id,
          transaction_id,
          billing_ledger_id,
          institution_id,
          tax_type,
          taxable_amount,
          tax_rate,
          tax_amount,
          currency_code,
          tax_status,
          jurisdiction,
          metadata
        )
        VALUES
        (
          $1,$2,$3,$4,$5,
          'VAT',
          $6,$7,$8,$9,
          'ACCRUED',
          $10,
          $11
        )
        ON CONFLICT (tax_event_id)
        DO NOTHING
        `,
        [
          taxEventId,
          economic_event_id,
          transaction_id,
          billing_ledger_id,
          institution_id,
          value,
          profile.vat_rate,
          vatAmount,
          currency_code,
          profile.tax_region,
          JSON.stringify({
            ...metadata,
            engine: 'taxEngine',
            fee_code,
            institution_id
          })
        ]
      );

      results.push({
        type: 'VAT',
        amount: vatAmount
      });
    }

    // ======================================================
    // WITHHOLDING
    // ======================================================
    if (
      rule.withholding &&
      profile.withholding_enabled
    ) {

      const whtAmount =
        pct(
          value,
          parseFloat(
            profile.withholding_rate
          )
        );

      const taxEventId =
        buildTaxEventId(
          economic_event_id,
          'WITHHOLDING'
        );

      await client.query(
        `
        INSERT INTO tax_transactions
        (
          tax_event_id,
          economic_event_id,
          transaction_id,
          billing_ledger_id,
          institution_id,
          tax_type,
          taxable_amount,
          tax_rate,
          tax_amount,
          currency_code,
          tax_status,
          jurisdiction,
          metadata
        )
        VALUES
        (
          $1,$2,$3,$4,$5,
          'WITHHOLDING',
          $6,$7,$8,$9,
          'ACCRUED',
          $10,
          $11
        )
        ON CONFLICT (tax_event_id)
        DO NOTHING
        `,
        [
          taxEventId,
          economic_event_id,
          transaction_id,
          billing_ledger_id,
          institution_id,
          value,
          profile.withholding_rate,
          whtAmount,
          currency_code,
          profile.tax_region,
          JSON.stringify({
            ...metadata,
            engine: 'taxEngine',
            fee_code,
            institution_id
          })
        ]
      );

      results.push({
        type: 'WITHHOLDING',
        amount: whtAmount
      });
    }

    // ======================================================
    // AUDIT
    // ======================================================
    await client.query(
      `
      INSERT INTO audit_log
      (actor, action, payload)
      VALUES ($1,$2,$3)
      `,
      [
        institution_id,
        'TAX_ACCRUED',
        JSON.stringify({
          economic_event_id,
          fee_code,
          taxes: results
        })
      ]
    );

    if (ownsTx) {
      await client.query('COMMIT');
    }

    return {
      status: 'TAX_APPLIED',
      taxes: results
    };

  } catch (err) {

    if (ownsTx) {
      await client.query('ROLLBACK');
    }

    throw err;

  } finally {

    if (!externalClient) {
      client.release();
    }
  }
}

module.exports = {
  applyTaxes
};