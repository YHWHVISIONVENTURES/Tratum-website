const pool = require('../db');
const { quoteBundle } = require('./feeEngine');
const { applyTaxes } =
  require('./taxEngine');

// ---------------------------------------------
// SAFE NUMBER
// ---------------------------------------------
function toNumber(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) throw new Error('INVALID_NUMBER');
  return n;
}

// ---------------------------------------------
// VALIDATION
// ---------------------------------------------
function validateInput({
  actor_id,
  actor_type,
  fee_codes,
  source_ref,
  source_type
}) {

  if (!actor_id || typeof actor_id !== 'string') {
    throw new Error('INVALID_ACTOR_ID');
  }

  if (!actor_type || typeof actor_type !== 'string') {
    throw new Error('INVALID_ACTOR_TYPE');
  }

  if (!Array.isArray(fee_codes) || fee_codes.length === 0) {
    throw new Error('INVALID_FEE_CODES');
  }

  if (!source_ref || typeof source_ref !== 'string') {
    throw new Error('INVALID_SOURCE_REF');
  }

  if (!source_type || typeof source_type !== 'string') {
    throw new Error('INVALID_SOURCE_TYPE');
  }
}

// ---------------------------------------------
// CORE BILLING ENTRY
// ---------------------------------------------
async function applyFees({
  actor_id,
  actor_type = 'INSTITUTION',
  amount,
  fee_codes,
  source_ref,
  source_type,
  currency_code = 'NGN',
  period_key = null,
  metadata = {},
  client: externalClient = null
}) {

  validateInput({
    actor_id,
    actor_type,
    fee_codes,
    source_ref,
    source_type
  });

  const value = toNumber(amount);

  if (value < 0) {
    throw new Error('INVALID_AMOUNT');
  }

  const client = externalClient || await pool.connect();
  let ownsTx = false;

  try {

    if (!externalClient) {
      await client.query('BEGIN');
      ownsTx = true;
    }

    // -----------------------------------------
    // 1. COMPUTE FEES
    // -----------------------------------------
    const fees = await quoteBundle(fee_codes, value);

    // -----------------------------------------
    // 2. WRITE BILLING LEDGER
    // -----------------------------------------
    for (const code of fee_codes) {

      const feeAmount = toNumber(fees[code]);

      if (feeAmount <= 0) continue;

      const metadata = {
        computed_on: value,
        fee_code: code,
        currency_code,
        ...this.metadata
      };

      const res = await client.query(`
        INSERT INTO billing_ledger
        (actor_id, actor_type, fee_code, amount, currency_code, source_ref, source_type, metadata, period_key, paid)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
        ON CONFLICT (actor_id, fee_code, source_ref)
        DO NOTHING
      `, [
        actor_id,
        actor_type,
        code,
        feeAmount,
        currency_code,
        source_ref,
        source_type,
        metadata,
        period_key
      ]);

      // -----------------------------------------
// 2.1 TAX ENGINE
// -----------------------------------------
if (res.rowCount > 0) {

  const economic_event_id =
    metadata?.economic_event_id || null;

  if (economic_event_id) {

    const billingLedger = await client.query(
      `
      SELECT id
      FROM billing_ledger
      WHERE actor_id=$1
      AND fee_code=$2
      AND source_ref=$3
      LIMIT 1
      `,
      [
        actor_id,
        code,
        source_ref
      ]
    );

    if (billingLedger.rows.length) {

      await applyTaxes({

        institution_id:
          actor_id,

        economic_event_id,

        billing_ledger_id:
          billingLedger.rows[0].id,

        fee_code: code,

        amount: feeAmount,

        currency_code,

        metadata: {
          source_type,
          source_ref
        },

        client
      });
    }
  }
}

      // -----------------------------------------
      // 3. AUDIT VISIBILITY
      // -----------------------------------------
      await client.query(`
        INSERT INTO billing_events_log
        (actor_id, fee_code, source_ref, event_type)
        VALUES ($1,$2,$3,$4)
      `, [
        actor_id,
        code,
        source_ref,
        res.rowCount === 0 ? 'DUPLICATE' : 'INSERTED'
      ]);
    }

    if (ownsTx) {
      await client.query('COMMIT');
    }

    return fees;

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

// ---------------------------------------------
// INVOICE GENERATION
// ---------------------------------------------
async function generateInvoices(period_key) {

  if (!period_key) {
    throw new Error('INVALID_PERIOD_KEY');
  }

  const result = await pool.query(`
    SELECT actor_id,
           SUM(amount)::numeric(20,2) AS total
    FROM billing_ledger
    WHERE paid=false
    AND period_key=$1
    GROUP BY actor_id
  `, [period_key]);

  return result.rows;
}

// ---------------------------------------------
// MARK PAID (SETTLEMENT SIGNAL)
// ---------------------------------------------
async function markActorPaid(actor_id) {

  if (!actor_id) {
    throw new Error('INVALID_ACTOR_ID');
  }

  const client = await pool.connect();

  try {

    await client.query('BEGIN');

    const rows = await client.query(`
      SELECT id
      FROM billing_ledger
      WHERE actor_id=$1
      AND paid=false
      FOR UPDATE
    `, [actor_id]);

    if (!rows.rows.length) {
      await client.query('ROLLBACK');
      return { status: 'NO_OUTSTANDING' };
    }

    await client.query(`
      UPDATE billing_ledger
      SET paid=true,
          paid_at=NOW()
      WHERE actor_id=$1
      AND paid=false
    `, [actor_id]);

    await client.query(`
      INSERT INTO settlement_history (actor_id, total_amount, method)
      VALUES (
        $1,
        (SELECT COALESCE(SUM(amount),0) FROM billing_ledger WHERE actor_id=$1),
        'BILLING_CLEAR'
      )
    `, [actor_id]);

    await client.query('COMMIT');

    return { status: 'PAID' };

  } catch (err) {

    await client.query('ROLLBACK');
    throw err;

  } finally {
    client.release();
  }
}

// ---------------------------------------------
// DELINQUENCY MONITOR
// ---------------------------------------------
async function getDelinquentActors(days = 7) {

  const d = toNumber(days);

  const result = await pool.query(`
    SELECT 
      actor_id,
      SUM(amount)::numeric(20,2) as total_due,
      COUNT(*)::int as overdue_count
    FROM billing_ledger
    WHERE paid=false
    AND created_at < NOW() - ($1 * INTERVAL '1 day')
    GROUP BY actor_id
    HAVING SUM(amount) > 0
    ORDER BY total_due DESC
  `, [d]);

  return result.rows;
}

module.exports = {
  applyFees,
  generateInvoices,
  markActorPaid,
  getDelinquentActors
};