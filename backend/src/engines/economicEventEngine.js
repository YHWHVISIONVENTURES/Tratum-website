// ==========================================================
// FILE: /engine/economicEventEngine.js
// ==========================================================

const crypto = require('crypto');
const pool = require('../db');

// ----------------------------------------------------------
function buildEconomicEventId(
  source_reference,
  actor_id
) {

  return crypto
    .createHash('sha256')
    .update(
      `${source_reference}|${actor_id}`
    )
    .digest('hex');
}

// ----------------------------------------------------------
async function createEconomicEvent({

  event_type,
  source_reference,
  actor_id,
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
      ownsTx = true;
      await client.query('BEGIN');
    }

    const economic_event_id =
      buildEconomicEventId(
        source_reference,
        actor_id
      );

    await client.query(
      `
      INSERT INTO economic_events
      (
        economic_event_id,
        event_type,
        source_reference,
        actor_id,
        amount,
        currency_code,
        metadata
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT
      (economic_event_id)
      DO NOTHING
      `,
      [
        economic_event_id,
        event_type,
        source_reference,
        actor_id,
        amount,
        currency_code,
        metadata
      ]
    );

    if (ownsTx) {
      await client.query('COMMIT');
    }

    return economic_event_id;

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
  createEconomicEvent
};