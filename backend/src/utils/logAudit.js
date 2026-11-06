exports.logAudit = async (client, actor, action, payload) => {
  await client.query(`
    INSERT INTO audit_log(actor, action, payload)
    VALUES($1,$2,$3)
  `, [actor, action, payload]);
};