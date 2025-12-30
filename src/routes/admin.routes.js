const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { apiLimiter } = require('../middleware/rateLimit.middleware');
const adminController = require('../controllers/admin.controller');

// Note: In production, add admin role verification middleware

/**
 * Create new partner
 * Requires: Firebase auth token + admin role
 */
router.post('/partners', verifyFirebaseToken, apiLimiter, adminController.createPartner);

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

module.exports = router;
