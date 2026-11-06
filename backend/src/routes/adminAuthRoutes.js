// =====================================================
// FILE: src/routes/adminAuthRoutes.js
// =====================================================

const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/adminAuthController');

router.post('/admin/v1/auth/login', ctrl.login);

module.exports = router;