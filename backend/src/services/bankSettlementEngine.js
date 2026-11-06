const pool = require('../db');
const BankRailAdapter = require('../adapters/bankRailAdapter');

const rail = new BankRailAdapter({
  name: process.env.BANK_NAME,
  apiKey: process.env.BANK_API_KEY,
  secret: process.env.BANK_SECRET,
  endpoint: process.env.BANK_ENDPOINT
});

async function processInstitutionTransaction(inst, tx) {

  if (!tx || !tx.tx_hash) {
    throw new Error("INVALID_TX");
  }

  const exists = await pool.query(
    `SELECT 1 FROM settlement_intents WHERE tx_hash=$1`,
    [tx.tx_hash]
  );

  if (exists.rows.length) {
    return { status: "DUPLICATE" };
  }

  await pool.query(
    `INSERT INTO settlement_intents
     (tx_hash, institution_id, sender_id, receiver_id, amount, status)
     VALUES ($1,$2,$3,$4,$5,'PENDING')`,
    [
      tx.tx_hash,
      inst.id,
      tx.senderID,
      tx.receiverID,
      Number(tx.amount)
    ]
  );

  const railResult = await rail.sendTransfer({
    from: tx.senderID,
    to: tx.receiverID,
    amount: Number(tx.amount),
    reference: tx.tx_hash
  });

  await pool.query(
    `UPDATE settlement_intents
     SET status='SENT'
     WHERE tx_hash=$1`,
    [tx.tx_hash]
  );

  await pool.query(
    `INSERT INTO transactions
     (tx_hash, sender_id, receiver_id, amount, timestamp, nonce, status, synced, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,1,true,$7)
     ON CONFLICT (tx_hash) DO NOTHING`,
    [
      tx.tx_hash,
      tx.senderID,
      tx.receiverID,
      Number(tx.amount),
      Number(tx.timestamp),
      Number(tx.nonce),
      JSON.stringify({
        ...tx,
        institution_id: inst.id,
        rail_result: railResult
      })
    ]
  );

  return {
    status: "TRANSFER_SENT",
    rail: railResult.rail
  };
}

module.exports = {
  processInstitutionTransaction
};