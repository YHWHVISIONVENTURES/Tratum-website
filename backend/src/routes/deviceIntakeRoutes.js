const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const requirePermission = require('../middleware/requirePermission');
const controller = require('../controllers/deviceIntakeController');

router.get('/admin/v1/device-intakes', adminAuth, requirePermission('DEVICE_ENROLL'), controller.listIntakes);
router.post('/admin/v1/device-intakes', adminAuth, requirePermission('DEVICE_ENROLL'), controller.createIntake);

module.exports = router;
