const express = require('express');
const router = express.Router();

const authorize = [require('../middleware/adminAuth'), require('../middleware/requirePermission')('INSTITUTIONS_MANAGE')];
const admin = require('../controllers/adminInstitutionController');

// create institution
router.post('/institutions', ...authorize, admin.createInstitution);

// list institutions
router.get('/institutions', ...authorize, admin.listInstitutions);

// disable institution
router.patch('/institutions/:id/disable', ...authorize, admin.disableInstitution);

module.exports = router;
