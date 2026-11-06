// =====================================================
// FILE: src/controllers/adminAuthController.js
// =====================================================

const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
  try {

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'EMAIL_AND_PASSWORD_REQUIRED' });
    }

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'EMAIL_AND_PASSWORD_REQUIRED' });
    }

    const user = await pool.query(
      `SELECT *
       FROM admin_users
       WHERE email=$1
       AND status='ACTIVE'
       LIMIT 1`,
      [email]
    );

    if (!user.rows.length) {
      return res.status(401).json({
        ok:false,
        error:'INVALID_LOGIN'
      });
    }

    const row = user.rows[0];

    const pass = await bcrypt.compare(
      password,
      row.password_hash
    );

    if (!pass) {
      return res.status(401).json({
        ok:false,
        error:'INVALID_LOGIN'
      });
    }

    const role = await pool.query(
      `SELECT permissions
       FROM admin_roles
       WHERE role_code=$1
       LIMIT 1`,
      [row.role_code]
    );

    const permissions =
      role.rows[0]?.permissions || [];

    const token = jwt.sign(
      {
        id: row.id,
        email: row.email,
        role: row.role_code,
        permissions
      },
      process.env.ADMIN_JWT_SECRET,
      { expiresIn:'12h' }
    );

    await pool.query(
      `UPDATE admin_users
       SET last_login=NOW()
       WHERE id=$1`,
      [row.id]
    );

    return res.json({
      ok:true,
      token,
      role:row.role_code,
      permissions
    });

  } catch (err) {
    return res.status(500).json({
      ok:false,
      error:'LOGIN_UNAVAILABLE'
    });
  }
};



