// =====================================================
// FILE: src/middleware/requirePermission.js
// =====================================================

module.exports = function requirePermission(permission) {
  return (req, res, next) => {

    const perms = req.admin.permissions || [];

    if (!perms.includes(permission)) {
      return res.status(403).json({
        ok:false,
        error:'ACCESS_DENIED'
      });
    }

    next();
  };
};