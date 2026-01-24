const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { apiLimiter } = require('../middleware/rateLimit.middleware');
const organizationController = require('../controllers/organization.controller');

/**
 * Get current user's organization
 */
router.get('/my', verifyFirebaseToken, apiLimiter, organizationController.getMyOrganization);

/**
 * Get organization by ID
 */
router.get('/:orgId', verifyFirebaseToken, apiLimiter, organizationController.getOrganizationById);

/**
 * Update organization
 */
router.put('/:orgId', verifyFirebaseToken, apiLimiter, organizationController.updateOrganization);

module.exports = router;
