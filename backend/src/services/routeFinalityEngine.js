const pool = require('../db');

// -----------------------------------
// CREATE TRACKER
// -----------------------------------
async function registerFinality({
  reference,
  rail_type,
  operation,
  route = {},
  required_confirmations = 1,
  source_reference = null,
  metadata = {}
}) {

  await pool.query(
    `INSERT INTO route_finality
     (
      reference,
      rail_type,
      operation,
      route,
      required_confirmations,
      source_reference,
      metadata
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (reference) DO NOTHING`,
    [
      reference,
      rail_type,
      operation,
      route,
      required_confirmations,
      source_reference,
      metadata
    ]
  );
}

// -----------------------------------
// UPDATE CONFIRMATION
// -----------------------------------
async function confirm(reference, count = 1) {

  await pool.query(
    `UPDATE route_finality
     SET confirmations = confirmations + $2,
         updated_at = NOW()
     WHERE reference=$1`,
    [reference, count]
  );

  await autoFinalize(reference);
}

// -----------------------------------
// AUTO FINALIZE
// -----------------------------------
async function autoFinalize(reference) {

  const result = await pool.query(
    `SELECT *
     FROM route_finality
     WHERE reference=$1
     LIMIT 1`,
    [reference]
  );

  if (!result.rows.length) return;

  const row = result.rows[0];

  // -----------------------------------
// HARD FINALITY CALLBACK
// -----------------------------------
if (
  row.confirmations >=
  row.required_confirmations
) {

  process.stdout.write(
    JSON.stringify({
      event:
        'ROUTE_FINALIZED',

      reference:
        reference,

      rail:
        row.rail_type
    }) + '\n'
  );
}

  if (
    row.confirmations >=
    row.required_confirmations
  ) {

    await pool.query(
      `UPDATE route_finality
       SET status='FINAL',
           finalized_at=NOW(),
           updated_at=NOW()
       WHERE reference=$1`,
      [reference]
    );
  } else {

    await pool.query(
      `UPDATE route_finality
       SET status='SOFT_FINAL',
           updated_at=NOW()
       WHERE reference=$1`,
      [reference]
    );

    await pool.query(
`
UPDATE treasury_liquidity_locks
SET status='FINALIZED'
WHERE lock_id=$1
`,
[reference]
);

  }
}

// -----------------------------------
// FAIL
// -----------------------------------
async function fail(reference, reason) {

  await pool.query(
    `UPDATE route_finality
     SET status='FAILED',
         metadata =
         COALESCE(metadata,'{}'::jsonb)
         || jsonb_build_object('reason',$2),
         updated_at=NOW()
     WHERE reference=$1`,
    [reference, reason]
  );

  await pool.query(
`
UPDATE treasury_liquidity_locks
SET status='FAILED'
WHERE lock_id=$1
`,
[reference]
);

}

module.exports = {
  registerFinality,
  confirm,
  fail
};