// =====================================================
// FILE: src/middleware/adminAuth.js
// JWT VERIFY
// =====================================================

const jwt = require('jsonwebtoken');

module.exports = function adminAuth(req, res, next) {
  try {
    const auth = req.headers.authorization;

    if (!auth) {
      return res.status(401).json({
        ok:false,
        error:'NO_TOKEN'
      });
    }

    const token = auth.replace('Bearer ', '');

    const decoded = jwt.verify(
      token,
      process.env.ADMIN_JWT_SECRET
    );

    if (decoded.scope === 'bank' || decoded.aud === 'tratum-bank') return res.status(403).json({error:'ACCESS_DENIED'});
    req.admin = decoded;

    next();

  } catch (err) {
    return res.status(401).json({
      ok:false,
      error:'INVALID_TOKEN'
    });
  }
};
