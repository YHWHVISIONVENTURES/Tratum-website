const pool = require('../db');
const crypto = require('crypto');

// ---------------------------------------------
// BUILD ID (DETERMINISTIC)
// ---------------------------------------------
function buildIntentId(economic_event_id) {
  return crypto
    .createHash('sha256')
    .update(`BILLING|${economic_event_id}`)
    .digest('hex');
}

// ---------------------------------------------
// CREATE INTENTS FROM BILLING
// ---------------------------------------------
async function createBillingIntents(limit = 100) {

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // -----------------------------------------
    // LOCK ELIGIBLE BILLING ROWS
    // -----------------------------------------
    const rows = await client.query(`
      SELECT *
      FROM billing_ledger
      WHERE paid = false
      AND created_at <= NOW() - INTERVAL '1 minute'
      ORDER BY created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `, [limit]);

    if (!rows.rows.length) {
      await client.query('COMMIT');
      return { status: 'NO_WORK' };
    }

    let created = 0;

    for (const row of rows.rows) {

      const economic_event_id =
        row.metadata?.economic_event_id;

      if (!economic_event_id) continue;

      const intentId =
        buildIntentId(economic_event_id);

      const res = await client.query(`
        INSERT INTO settlement_intents (
          tx_hash,
          institution_id,
          sender_id,
          receiver_id,
          amount,
          status,
          settlement_type,
          economic_event_id,
          reference,
          metadata
        )
        VALUES ($1,$2,$3,$4,$5,'PENDING','BILLING',$6,$7,$8)
        ON CONFLICT (economic_event_id) DO NOTHING
        RETURNING id
      `, [
        intentId,
        row.actor_id,
        row.actor_id,
        'TREASURY',
        row.amount,
        economic_event_id,
        row.source_ref,
        JSON.stringify({
          billing_id: row.id
        })
      ]);

      if (res.rowCount > 0) {
        created++;
      }
    }

    await client.query('COMMIT');

    return {
      status: 'CREATED',
      count: created
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createBillingIntents
};