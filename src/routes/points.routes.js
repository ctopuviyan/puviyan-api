const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { apiLimiter } = require('../middleware/rateLimit.middleware');
const pointsController = require('../controllers/points.controller');

/**
 * Get user's points balance
 * Requires: Firebase auth token
 */
router.get('/balance', verifyFirebaseToken, apiLimiter, pointsController.getPointsBalance);

/**
 * Calculate discount for given points
 * Requires: Firebase auth token
 */
router.post('/calculate', verifyFirebaseToken, apiLimiter, pointsController.calculateDiscount);

/**
 * Get available offers
 * Requires: Firebase auth token (optional)
 */
router.get('/offers', apiLimiter, pointsController.getAvailableOffers);

/**
 * Add points to user (for testing only)
 * No auth required for testing
 */
router.post('/add', apiLimiter, pointsController.addPoints);

module.exports = router;
