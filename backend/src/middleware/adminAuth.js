// =====================================================
// FILE: src/middleware/adminAuth.js
// JWT VERIFY
// =====================================================

const jwt = require('jsonwebtoken');
const pool = require('../db');

module.exports = async function adminAuth(req, res, next) {
  try {
    const auth = req.headers.authorization;

    if (!auth) {
      return res.status(401).json({
        ok:false,
        error:'NO_TOKEN'
      });
    }

    const match = /^Bearer ([^\s]+)$/.exec(auth);
    if (!match) return res.status(401).json({ok:false,error:'INVALID_TOKEN'});
    const token = match[1];

    const decoded = jwt.verify(
      token,
      process.env.ADMIN_JWT_SECRET,
      { algorithms: ['HS256'] }
    );

    if (typeof decoded.id !== 'string' && typeof decoded.id !== 'number') return res.status(401).json({ok:false,error:'INVALID_TOKEN'});
    let found;
    try {
      found = await pool.query(`SELECT u.id,u.email,u.role_code,r.permissions FROM admin_users u
        JOIN admin_roles r ON r.role_code=u.role_code WHERE u.id::text=$1 AND u.status='ACTIVE'`, [String(decoded.id)]);
    } catch(error) { return next(error); }
    if (!found.rowCount) return res.status(401).json({ok:false,error:'INVALID_TOKEN'});
    const user=found.rows[0];
    req.admin = {id:user.id,email:user.email,role:user.role_code,permissions:Array.isArray(user.permissions)?user.permissions:[]};
    res.set('Cache-Control','no-store');

    next();

  } catch (err) {
    return res.status(401).json({
      ok:false,
      error:'INVALID_TOKEN'
    });
  }
};
