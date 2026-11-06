const pool = require('../db');
const crypto = require('crypto');

const { applyFees } = require('../services/billingEngine');
const { postTreasuryEntry } =
  require('../services/treasuryEngine');


// --------------------------------------------------
// HELPERS
// --------------------------------------------------
function buildEconomicEventId(type, ref, actor) {
  return crypto
    .createHash('sha256')
    .update(`${type}|${ref}|${actor}`)
    .digest('hex');
}

function assertAmount(amount) {
  if (!amount || typeof amount !== 'string') {
    throw new Error('INVALID_AMOUNT');
  }

  if (amount === '0' || amount.startsWith('-')) {
    throw new Error('INVALID_AMOUNT');
  }
}

// --------------------------------------------------
// DEPOSIT (MINT)
// --------------------------------------------------
exports.depositToNode = async (req, res) => {
  const client = await pool.connect();

  try {
    const { device_id, amount, source_ref } = req.body;

    // -------------------------------------
    // INPUT VALIDATION
    // -------------------------------------
    if (!device_id || !source_ref) {
      return res.status(400).json({ ok: false, error: 'INVALID_INPUT' });
    }

    assertAmount(amount);

    await client.query('BEGIN');

    // -------------------------------------
    // DEVICE + ISSUER LOCK
    // -------------------------------------
    const device = await client.query(
      `SELECT device_id, issuer_id 
       FROM devices 
       WHERE device_id=$1 
       FOR UPDATE`,
      [device_id]
    );

    if (!device.rows.length) {
      throw new Error('DEVICE_NOT_FOUND');
    }

    const issuer_id = device.rows[0].issuer_id;

    // -------------------------------------
    // DEVICE STATUS CHECK
    // -------------------------------------
    const status = await client.query(
      `SELECT status FROM device_registry WHERE device_id=$1`,
      [device_id]
    );

    if (!status.rows.length) throw new Error('DEVICE_NOT_FOUND');
    if (status.rows[0].status !== 'ACTIVE') {
      throw new Error('DEVICE_BLOCKED');
    }

    const trust = await client.query(
 `
 SELECT
   attestation_status,
   token_expiry
 FROM device_trust_state
 WHERE device_id=$1
 LIMIT 1
 `,
 [device_id]
);

if (!trust.rows.length) {
  throw new Error('DEVICE_NOT_ATTESTED');
}

if (
  trust.rows[0].attestation_status !== 'VERIFIED'
) {
  throw new Error('DEVICE_UNTRUSTED');
}

if (
  Number(trust.rows[0].token_expiry)
  < Date.now()
) {
  throw new Error('ATTESTATION_EXPIRED');
}

    // -------------------------------------
    // IDEMPOTENCY
    // -------------------------------------
    const existing = await client.query(
      `SELECT 1 FROM node_value_ledger WHERE reference=$1 LIMIT 1`,
      [source_ref]
    );

    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, status: 'IDEMPOTENT_REPLAY' });
    }

    // -------------------------------------
    // ECONOMIC EVENT ID
    // -------------------------------------
    const economic_event_id = buildEconomicEventId(
      'MINT',
      source_ref,
      issuer_id
    );

    // -------------------------------------
    // LEDGER ENTRY (VALUE CREATION)
    // -------------------------------------
    await client.query(
      `INSERT INTO node_value_ledger
       (device_id, amount, entry_type, reference, metadata)
       VALUES ($1,$2,'MINT',$3,$4)`,
      [
        device_id,
        amount,
        source_ref,
        JSON.stringify({ economic_event_id })
      ]
    );

    // -------------------------------------
    // TREASURY MIRROR
    // -------------------------------------
    await client.query(
      `INSERT INTO treasury_movements
       (direction, amount, reference, source)
       VALUES ('IN',$1,$2,'BANK')`,
      [amount, source_ref]
    );

    // -------------------------------------
    // 💰 BILLING (ACCOUNTS RECEIVABLE)
    // -------------------------------------
    await applyFees({
      actor_id: issuer_id,
      actor_type: 'INSTITUTION',
      amount: amount,
      fee_codes: ['MINT_FEE', 'PROTOCOL_GAS'],
      source_ref: source_ref,
      source_type: 'MINT',
      currency_code: 'NGN',
      metadata: {
        device_id,
        economic_event_id,
        flow: 'MINT'
      },
      client
    });

    // -------------------------------------
    // BALANCE UPDATE
    // -------------------------------------
    // Balance update
await client.query(
  `UPDATE devices
   SET balance = balance + $1
   WHERE device_id = $2`,
  [amount, device_id]
);

// ==========================================
// TREASURY RESERVE CREDIT
// ==========================================
await postTreasuryEntry({
  account_code: 'TREASURY_NGN',
  direction: 'CREDIT',
  amount,
  currency_code: 'NGN',
  reference: source_ref,
  source_type: 'MINT',
  economic_event_id,
  client
});

// ==========================================
// LIABILITY INCREASE
// System now owes this value
// ==========================================
await postTreasuryEntry({
  account_code: 'LIABILITY_NGN',
  direction: 'CREDIT',
  amount,
  currency_code: 'NGN',
  reference: source_ref,
  source_type: 'MINT_LIABILITY',
  economic_event_id,
  client
});

    await client.query('COMMIT');

    // -------------------------------------
    // SETTLEMENT PIPELINE HOOK (ASYNC)
    // -------------------------------------
    await pool.query(
      `INSERT INTO settlement_bridge
       (operation_type, device_id, institution_id, amount, reference, status)
       VALUES ('MINT',$1,$2,$3,$4,'PENDING')`,
      [device_id, issuer_id, amount, source_ref]
    );

    return res.json({
      ok: true,
      action: 'DEPOSIT_SUCCESS',
      economic_event_id
    });

  } catch (err) {
    await client.query('ROLLBACK');

    console.error('[MINT_FAILED]', {
      device_id: req.body?.device_id,
      error: err.message
    });

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  } finally {
    client.release();
  }
};

// --------------------------------------------------
// REDEEM (BURN)
// --------------------------------------------------
exports.redeemFromNode = async (req, res) => {
  const client = await pool.connect();

  try {
    const { device_id, amount, destination_ref } = req.body;

    // -------------------------------------
    // INPUT VALIDATION
    // -------------------------------------
    if (!device_id || !destination_ref) {
      return res.status(400).json({ ok: false, error: 'INVALID_INPUT' });
    }

    assertAmount(amount);

    await client.query('BEGIN');

    // -------------------------------------
    // DEVICE LOCK
    // -------------------------------------
    const device = await client.query(
      `SELECT balance, issuer_id 
       FROM devices 
       WHERE device_id=$1 
       FOR UPDATE`,
      [device_id]
    );

    if (!device.rows.length) {
      throw new Error('DEVICE_NOT_FOUND');
    }



    const issuer_id = device.rows[0].issuer_id;

    // -------------------------------------
    // DEVICE STATUS
    // -------------------------------------
    const status = await client.query(
      `SELECT status FROM device_registry WHERE device_id=$1`,
      [device_id]
    );

    if (!status.rows.length) throw new Error('DEVICE_NOT_FOUND');
    if (status.rows[0].status !== 'ACTIVE') {
      throw new Error('DEVICE_BLOCKED');
    }

    const trust = await client.query(
 `
 SELECT
   attestation_status,
   token_expiry
 FROM device_trust_state
 WHERE device_id=$1
 LIMIT 1
 `,
 [device_id]
);

if (!trust.rows.length) {
  throw new Error('DEVICE_NOT_ATTESTED');
}

if (
  trust.rows[0].attestation_status !== 'VERIFIED'
) {
  throw new Error('DEVICE_UNTRUSTED');
}

if (
  Number(trust.rows[0].token_expiry)
  < Date.now()
) {
  throw new Error('ATTESTATION_EXPIRED');
}

    // -------------------------------------
    // IDEMPOTENCY
    // -------------------------------------
    const existing = await client.query(
      `SELECT 1 FROM node_value_ledger WHERE reference=$1 LIMIT 1`,
      [destination_ref]
    );

    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, status: 'IDEMPOTENT_REPLAY' });
    }

    const balance = device.rows[0].balance;

    if (balance < amount) {
      throw new Error('INSUFFICIENT_FUNDS');
    }

    // -------------------------------------
    // ECONOMIC EVENT ID
    // -------------------------------------
    const economic_event_id = buildEconomicEventId(
      'BURN',
      destination_ref,
      issuer_id
    );

    // -------------------------------------
    // LEDGER ENTRY
    // -------------------------------------
    await client.query(
      `INSERT INTO node_value_ledger
       (device_id, amount, entry_type, reference, metadata)
       VALUES ($1,$2,'BURN',$3,$4)`,
      [
        device_id,
        amount,
        destination_ref,
        JSON.stringify({ economic_event_id })
      ]
    );

    // -------------------------------------
    // TREASURY MIRROR
    // -------------------------------------
    await client.query(
      `INSERT INTO treasury_movements
       (direction, amount, reference, source)
       VALUES ('OUT',$1,$2,'NODE')`,
      [amount, destination_ref]
    );

    // -------------------------------------
    // 💰 BILLING (AR CREATION)
    // -------------------------------------
    await applyFees({
      actor_id: issuer_id,
      actor_type: 'INSTITUTION',
      amount: amount,
      fee_codes: ['BURN_FEE', 'SETTLEMENT_FEE'],
      source_ref: destination_ref,
      source_type: 'BURN',
      currency_code: 'NGN',
      metadata: {
        device_id,
        economic_event_id,
        flow: 'BURN'
      },
      client
    });

    // -------------------------------------
    // BALANCE UPDATE
    // -------------------------------------
    // Deduct
await client.query(
  `UPDATE devices
   SET balance = balance - $1
   WHERE device_id=$2`,
  [amount, device_id]
);

// ==========================================
// TREASURY RESERVE DEBIT
// ==========================================
await postTreasuryEntry({
  account_code: 'TREASURY_NGN',
  direction: 'DEBIT',
  amount,
  currency_code: 'NGN',
  reference: destination_ref,
  source_type: 'BURN',
  economic_event_id,
  client
});

// ==========================================
// LIABILITY REDUCTION
// ==========================================
await postTreasuryEntry({
  account_code: 'LIABILITY_NGN',
  direction: 'DEBIT',
  amount,
  currency_code: 'NGN',
  reference: destination_ref,
  source_type: 'BURN_LIABILITY',
  economic_event_id,
  client
});

    await client.query('COMMIT');

    // -------------------------------------
    // SETTLEMENT HOOK
    // -------------------------------------
    await pool.query(
      `INSERT INTO settlement_bridge
       (operation_type, device_id, institution_id, amount, reference, status)
       VALUES ('BURN',$1,$2,$3,$4,'PENDING')`,
      [device_id, issuer_id, amount, destination_ref]
    );

    return res.json({
      ok: true,
      action: 'REDEMPTION_SUCCESS',
      economic_event_id
    });

  } catch (err) {
    await client.query('ROLLBACK');

    console.error('[BURN_FAILED]', {
      device_id: req.body?.device_id,
      error: err.message
    });

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  } finally {
    client.release();
  }
};

// --------------------------------------------------
// BALANCE CHECK
// --------------------------------------------------
exports.getNodeBalance = async (req, res) => {
  try {
    const { device_id } = req.params;

    const result = await pool.query(
      `SELECT balance FROM devices WHERE device_id=$1`,
      [device_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        ok: false,
        error: 'DEVICE_NOT_FOUND'
      });
    }

    return res.json({
      ok: true,
      balance: result.rows[0].balance
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};