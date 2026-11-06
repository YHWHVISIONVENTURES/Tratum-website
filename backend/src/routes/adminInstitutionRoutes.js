const express = require('express');
const router = express.Router();

router.use(require('../middleware/adminAuth'));
router.use(require('../middleware/requirePermission')('INSTITUTIONS_MANAGE'));
const admin = require('../controllers/adminInstitutionController');

// create institution
router.post('/institutions', admin.createInstitution);

// list institutions
router.get('/institutions', admin.listInstitutions);

// disable institution
router.patch('/institutions/:id/disable', admin.disableInstitution);

module.exports = router;
