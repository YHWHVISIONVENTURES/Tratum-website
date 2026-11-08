const express = require('express');
const router = express.Router();

const auth =
require('../middleware/institutionAuth');

const sign =
require('../middleware/requestSignerVerify');

const overview =
require('../controllers/portalOverviewController');

const billing =
require('../controllers/portalBillingController');

const nodes =
require('../controllers/portalNodesController');

const security =
require('../controllers/portalSecurityController');

const logs =
require('../controllers/PortalLogsController');

router.get('/portal/dashboard/overview', auth, sign, overview.getOverview);
router.get('/portal/dashboard/billing', auth, sign, billing.getBilling);
router.get('/portal/dashboard/nodes', auth, sign, nodes.getNodes);
router.get('/portal/dashboard/security', auth, sign, security.getSecurity);
router.get('/portal/dashboard/logs', auth, sign, logs.getLogs);

module.exports = router;
