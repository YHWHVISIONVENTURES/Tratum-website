const router = require('express').Router();
const ctrl = require('../controllers/deviceCertificateController');
const adminAuth = require('../middleware/adminAuth');

// 1. THE MISSING STATUS ROUTE (Linked to the controller function we verified)
router.get('/device/status/:device_id', adminAuth, ctrl.getDeviceStatus);

// 2. THE EXISTING CONTROL ROUTES
router.post('/admin/device/revoke', adminAuth, ctrl.revokeDevice);
router.post('/admin/device/suspend', adminAuth, ctrl.suspendDevice);
router.post('/admin/device/rotate', adminAuth, ctrl.rotateKeypair);

// 3. THE BROADCAST ROUTE (Usually for the devices to check)
router.get('/device/revocations', ctrl.getRevocations);

module.exports = router;

