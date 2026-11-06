const pool = require('../db');
const crypto = require('crypto');

// --------------------------------------------------
// DETERMINISTIC EVENT ID (IDEMPOTENCY CORE)
// --------------------------------------------------
function buildEventId(source_ref, fee_type) {
  return crypto
    .createHash('sha256')
    .update(`${source_ref}|${fee_type}`)
    .digest('hex');
}

// --------------------------------------------------
// REVENUE SPLIT MODEL (SOVEREIGN CONFIG)
// --------------------------------------------------
const DEFAULT_SPLIT = [
  { bucket: 'TREASURY', pct: 50 },
  { bucket: 'OPS', pct: 20 },
  { bucket: 'PARTNER', pct: 15 },
  { bucket: 'FOUNDATION', pct: 10 },
  { bucket: 'BURN', pct: 5 }
];

// --------------------------------------------------
// CORE ENGINE
// --------------------------------------------------
async function recordRevenue({
  source_type,
  source_ref,
  fee_type,
  amount,
  currency_code = 'NGN',
  metadata = {},
  client: externalClient = null
}) {

  const client = externalClient || await pool.connect();
  let ownsTransaction = false;

  try {

    if (!externalClient) {
      await client.query('BEGIN');
      ownsTransaction = true;
    }

    // --------------------------------------------------
    // 1. VALIDATION LAYER (FAIL FAST)
    // --------------------------------------------------
    if (!source_type || !source_ref || !fee_type) {
      throw new Error('INVALID_REVENUE_INPUT');
    }

    if (amount == null || Number(amount) <= 0) {
      throw new Error('INVALID_REVENUE_AMOUNT');
    }

    // --------------------------------------------------
    // 2. DETERMINISTIC ID (IDEMPOTENCY CORE)
    // --------------------------------------------------
    const eventId = buildEventId(source_ref, fee_type);

    const existing = await client.query(
      `SELECT 1 FROM revenue_events WHERE event_id=$1 LIMIT 1`,
      [eventId]
    );

    if (existing.rows.length) {
      if (ownsTransaction) await client.query('ROLLBACK');
      return { status: 'DUPLICATE_EVENT_SKIPPED' };
    }

    // --------------------------------------------------
    // 3. INSERT GROSS EVENT
    // --------------------------------------------------
    const ins = await client.query(
      `INSERT INTO revenue_events
       (event_id, source_type, source_ref, fee_type, gross_amount, currency_code, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        eventId,
        source_type,
        source_ref,
        fee_type,
        amount, // DB handles NUMERIC precision
        currency_code,
        metadata
      ]
    );

    const event = ins.rows[0];

    // --------------------------------------------------
    // 4. DISTRIBUTION ENGINE (ATOMIC SPLIT)
    // --------------------------------------------------
    for (const s of DEFAULT_SPLIT) {

      const share = Number(amount) * (s.pct / 100);

      await client.query(
        `INSERT INTO revenue_distributions
         (revenue_event_id, bucket, percentage, amount, currency_code)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          event.id,
          s.bucket,
          s.pct,
          share,
          currency_code
        ]
      );

      // --------------------------------------------------
      // 5. WALLET UPDATE (HARDENED CHECK)
      // --------------------------------------------------
      const walletUpdate = await client.query(
        `UPDATE revenue_wallets
         SET balance = balance + $1,
             updated_at = NOW()
         WHERE wallet_code = $2
         RETURNING id`,
        [share, s.bucket]
      );

      if (walletUpdate.rowCount === 0) {
        throw new Error(`WALLET_NOT_FOUND: ${s.bucket}`);
      }

       // =====================================================
      // 💸 partner PAYOUT QUEUE (INJECT HERE)
      // =====================================================
      // We only queue a physical payout for the 'PARTNER' bucket
      if (s.bucket === 'PARTNER') {
        
        // We resolve the actor_id from metadata (passed from p2pIngestion/billing)
        const partnerId = metadata.issuer_id || metadata.actor_id;

        if (partnerId) {
          const { queuePayout } = require('./payoutEngine');
          
          await queuePayout({
            actor_id: partnerId,
            actor_type: 'NODE_OPERATOR',
            payout_type: 'NODE_REWARD',
            source_type: 'TREASURY_REVENUE',
            source_reference: event.id, // The ID of this revenue event
            economic_event_id: metadata.economic_event_id || eventId,
            currency_code: currency_code,
            amount: share,
            client: client // 🛡️ ATOMIC
          });
        }
      }

    }

    // --------------------------------------------------
    // 6. FINALIZE EVENT STATE
    // --------------------------------------------------
    await client.query(
      `UPDATE revenue_events
       SET status='SETTLED',
           settled_at=NOW()
       WHERE id=$1`,
      [event.id]
    );

    // --------------------------------------------------
    // 7. COMMIT (ATOMIC GUARANTEE)
    // --------------------------------------------------
    if (ownsTransaction) {
      await client.query('COMMIT');
    }

    return {
      status: 'SETTLED',
      event_id: eventId,
      revenue_id: event.id
    };

  } catch (err) {

    if (ownsTransaction) {
      await client.query('ROLLBACK');
    }

    throw err;

  } finally {

    if (!externalClient) {
      client.release();
    }
  }
}

module.exports = { recordRevenue };