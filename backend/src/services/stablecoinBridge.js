const pool = require('../db');
const crypto = require('crypto');

const { applyFees } = require('./billingEngine');
const { recordRevenue } = require('./revenueLedger');
const { postTreasuryEntry } =
  require('../services/treasuryEngine');


// --------------------------------------------------
// SUPPORTED TOKENS
// --------------------------------------------------
const SUPPORTED_TOKENS = [
  'USDT',
  'USDC',
  'cNGN',
  'eNGN',
  'BTC',
  'ETH'
];

// --------------------------------------------------
// HELPERS
// --------------------------------------------------
function assertAmount(amount) {
  if (!amount || typeof amount !== 'string') {
    throw new Error('INVALID_AMOUNT');
  }

  if (amount === '0' || amount.startsWith('-')) {
    throw new Error('INVALID_AMOUNT');
  }
}

function assertToken(token) {
  if (!SUPPORTED_TOKENS.includes(token)) {
    throw new Error('UNSUPPORTED_TOKEN');
  }
}

function buildEconomicEventId(type, ref, actor) {
  return crypto
    .createHash('sha256')
    .update(`${type}|${ref}|${actor}`)
    .digest('hex');
}

// --------------------------------------------------
// BALANCE UPSERT
// --------------------------------------------------
async function upsertBalance(client, device_id, token, delta) {

  await client.query(
    `
    INSERT INTO stablecoin_balances
    (device_id, token, balance)
    VALUES ($1,$2,$3)

    ON CONFLICT (device_id, token)
    DO UPDATE SET
      balance = stablecoin_balances.balance + $3,
      updated_at = NOW()
    `,
    [device_id, token, delta]
  );
}

// --------------------------------------------------
// LOAD STABLE ASSET
// --------------------------------------------------
async function stableLoad(payload) {

  const client = await pool.connect();

  try {

    const {
      device_id,
      token,
      amount,
      issuer_id,
      source_ref
    } = payload;

    if (!device_id || !issuer_id || !source_ref) {
      throw new Error('INVALID_LOAD_PAYLOAD');
    }

    assertToken(token);
    assertAmount(amount);

    await client.query('BEGIN');
    await require('../services/deviceLifecycle').assertCurrentTrust(client,device_id);

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
      `
      SELECT 1
      FROM stablecoin_ledger
      WHERE reference=$1
      LIMIT 1
      `,
      [source_ref]
    );

    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return {
        status: 'IDEMPOTENT_REPLAY'
      };
    }

    // -------------------------------------
    // DEVICE VALIDATION
    // -------------------------------------
    const device = await client.query(
      `
      SELECT device_id
      FROM devices
      WHERE device_id=$1
      LIMIT 1
      `,
      [device_id]
    );

    if (!device.rows.length) {
      throw new Error('DEVICE_NOT_FOUND');
    }

    // -------------------------------------
    // ECONOMIC EVENT
    // -------------------------------------
    const economic_event_id =
      buildEconomicEventId(
        'STABLE_LOAD',
        source_ref,
        issuer_id
      );

    // -------------------------------------
    // LEDGER ENTRY
    // -------------------------------------
    await client.query(
      `
      INSERT INTO stablecoin_ledger
      (
        device_id,
        token,
        amount,
        entry_type,
        reference,
        metadata
      )
      VALUES ($1,$2,$3,'LOAD',$4,$5)
      `,
      [
        device_id,
        token,
        amount,
        source_ref,
        JSON.stringify({
          economic_event_id,
          issuer_id
        })
      ]
    );

    // -------------------------------------
    // BALANCE UPDATE
    // -------------------------------------
    await upsertBalance(
      client,
      device_id,
      token,
      amount
    );

    await postTreasuryEntry({
  account_code: `TREASURY_${token}`,
  direction: 'CREDIT',
  amount,
  currency_code: token,
  reference: payload.reference || device_id,
  source_type: 'STABLE_LOAD',
  economic_event_id,
  client
});

await postTreasuryEntry({
  account_code: `LIABILITY_${token}`,
  direction: 'CREDIT',
  amount,
  currency_code: token,
  reference: payload.reference || device_id,
  source_type: 'STABLE_LIABILITY',
  economic_event_id,
  client
});

    // -------------------------------------
    // BILLING
    // -------------------------------------
    await applyFees({
      actor_id: issuer_id,
      actor_type: 'INSTITUTION',
      amount,
      fee_codes: ['STABLE_LOAD_FEE'],
      source_ref,
      source_type: 'STABLE_LOAD',
      currency_code: token,
      metadata: {
        token,
        device_id,
        economic_event_id
      },
      client
    });

    await client.query('COMMIT');

    return {
      status: 'STABLE_LOADED',
      economic_event_id
    };

  } catch (err) {

    await client.query('ROLLBACK');
    throw err;

  } finally {

    client.release();
  }
}

// --------------------------------------------------
// STABLE SPEND
// --------------------------------------------------
async function stableSpend(payload) {

  const client = await pool.connect();

  try {

    const {
      device_id,
      token,
      amount,
      issuer_id,
      reference
    } = payload;

    if (!device_id || !issuer_id || !reference) {
      throw new Error('INVALID_SPEND_PAYLOAD');
    }

    assertToken(token);
    assertAmount(amount);

    await client.query('BEGIN');
    await require('../services/deviceLifecycle').assertCurrentTrust(client,device_id);

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
    // LOCK BALANCE
    // -------------------------------------
    const bal = await client.query(
      `
      SELECT balance
      FROM stablecoin_balances
      WHERE device_id=$1
      AND token=$2
      FOR UPDATE
      `,
      [device_id, token]
    );

    const current =
      bal.rows[0]?.balance || '0';

    if (current < amount) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    // -------------------------------------
    // ECONOMIC EVENT
    // -------------------------------------
    const economic_event_id =
      buildEconomicEventId(
        'STABLE_SPEND',
        reference,
        issuer_id
      );

    // -------------------------------------
    // BILLING
    // -------------------------------------
    const fees = await applyFees({
      actor_id: issuer_id,
      actor_type: 'INSTITUTION',
      amount,
      fee_codes: ['NETWORK_GAS_FEE'],
      source_ref: reference,
      source_type: 'STABLE_SPEND',
      currency_code: token,
      metadata: {
        token,
        device_id,
        economic_event_id
      },
      client
    });

    const gasFee =
      fees.NETWORK_GAS_FEE || '0';

    // -------------------------------------
    // TOTAL DEDUCTION
    // -------------------------------------
    const deduction =
      Number(amount) + Number(gasFee);

    if (Number(current) < deduction) {
      throw new Error('INSUFFICIENT_FOR_FEES');
    }

    // -------------------------------------
    // DEDUCT
    // -------------------------------------
    await client.query(
      `
      UPDATE stablecoin_balances
      SET balance = balance - $1,
          updated_at = NOW()
      WHERE device_id=$2
      AND token=$3
      `,
      [
        deduction,
        device_id,
        token
      ]
    );

    // -------------------------------------
    // REVENUE
    // -------------------------------------
    if (gasFee !== '0') {

      await recordRevenue({
        source_type: 'STABLE_SPEND',
        source_ref: reference,
        fee_type: 'NETWORK_GAS_FEE',
        amount: gasFee,
        currency_code: token,
        metadata: {
          token,
          device_id,
          economic_event_id
        },
        client
      });
    }

    await client.query('COMMIT');

    return {
      status: 'STABLE_SPEND_SUCCESS',
      fees
    };

  } catch (err) {

    await client.query('ROLLBACK');
    throw err;

  } finally {

    client.release();
  }
}

// --------------------------------------------------
// REDEEM
// --------------------------------------------------
async function stableRedeem(payload) {

  const client = await pool.connect();

  try {

    const {
      device_id,
      token,
      amount,
      issuer_id,
      destination_ref
    } = payload;

    if (!device_id || !destination_ref) {
      throw new Error('INVALID_REDEEM_PAYLOAD');
    }

    assertToken(token);
    assertAmount(amount);

    await client.query('BEGIN');
    await require('../services/deviceLifecycle').assertCurrentTrust(client,device_id);

    // -------------------------------------
    // LOCK BALANCE
    // -------------------------------------
    const bal = await client.query(
      `
      SELECT balance
      FROM stablecoin_balances
      WHERE device_id=$1
      AND token=$2
      FOR UPDATE
      `,
      [device_id, token]
    );

    const current =
      bal.rows[0]?.balance || '0';

    if (current < amount) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    // -------------------------------------
    // ECONOMIC EVENT
    // -------------------------------------
    const economic_event_id =
      buildEconomicEventId(
        'STABLE_REDEEM',
        destination_ref,
        issuer_id
      );

    // -------------------------------------
    // BILLING
    // -------------------------------------
    await applyFees({
      actor_id: issuer_id,
      actor_type: 'INSTITUTION',
      amount,
      fee_codes: ['STABLE_REDEEM_FEE'],
      source_ref: destination_ref,
      source_type: 'STABLE_REDEEM',
      currency_code: token,
      metadata: {
        token,
        device_id,
        economic_event_id
      },
      client
    });

    // -------------------------------------
    // DEDUCT
    // -------------------------------------
    await client.query(
      `
      UPDATE stablecoin_balances
      SET balance = balance - $1,
          updated_at = NOW()
      WHERE device_id=$2
      AND token=$3
      `,
      [
        amount,
        device_id,
        token
      ]
    );

    await postTreasuryEntry({
  account_code: `TREASURY_${token}`,
  direction: 'DEBIT',
  amount,
  currency_code: token,
  reference: reference || device_id,
  source_type: 'STABLE_REDEEM',
  economic_event_id,
  client
});

await postTreasuryEntry({
  account_code: `LIABILITY_${token}`,
  direction: 'DEBIT',
  amount,
  currency_code: token,
  reference: reference || device_id,
  source_type: 'STABLE_REDEEM_LIABILITY',
  economic_event_id,
  client
});

    await client.query('COMMIT');


    return {
      status: 'STABLE_REDEEM_SUCCESS',
      economic_event_id
    };

  } catch (err) {

    await client.query('ROLLBACK');
    throw err;

  } finally {

    client.release();
  }
}

module.exports = {
  stableLoad,
  stableSpend,
  stableRedeem
};