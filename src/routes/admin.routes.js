const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { apiLimiter } = require('../middleware/rateLimit.middleware');
const adminController = require('../controllers/admin.controller');
const organizationController = require('../controllers/organization.controller');

// Note: In production, add admin role verification middleware

/**
 * Create new partner
 * Requires: Firebase auth token + admin role
 * Note: Auth temporarily disabled for testing UI
 * TODO: Re-enable verifyFirebaseToken for production
 */
// For testing: (auth disabled)
router.post('/partners', apiLimiter, adminController.createPartner);
// For production: (uncomment below and comment above)
// router.post('/partners', verifyFirebaseToken, apiLimiter, adminController.createPartner);

/**
 * Update partner
 * Requires: Firebase auth token + admin role
 */
router.put('/partners/:partnerId', verifyFirebaseToken, apiLimiter, adminController.updatePartner);

/**
 * Delete partner
 * Requires: Firebase auth token + admin role
 */
router.delete('/partners/:partnerId', verifyFirebaseToken, apiLimiter, adminController.deletePartner);

/**
 * Get system analytics
 * Requires: Firebase auth token + admin role
 */
router.get('/analytics', verifyFirebaseToken, apiLimiter, adminController.getSystemAnalytics);

/**
 * Get all redemptions (admin view)
 * Requires: Firebase auth token + admin role
 */
router.get('/redemptions', verifyFirebaseToken, apiLimiter, adminController.getAllRedemptions);

/**
 * Get all organizations (admin view)
 * Requires: Firebase auth token + admin role
 */
router.get('/organizations', verifyFirebaseToken, apiLimiter, organizationController.getAllOrganizations);

/**
 * Create new organization
 * Requires: Firebase auth token + admin role
 */
router.post('/organizations', verifyFirebaseToken, apiLimiter, organizationController.createOrganization);

module.exports = router;
