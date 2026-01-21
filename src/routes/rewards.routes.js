const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { apiLimiter, redemptionLimiter } = require('../middleware/rateLimit.middleware');
const { cacheMiddleware } = require('../middleware/cache.middleware');
const rewardsController = require('../controllers/rewards.controller');

/**
 * Get all available rewards (public)
 * Cache for 5 minutes
 */
router.get('/', cacheMiddleware(300), apiLimiter, rewardsController.getAvailableRewards);

/**
 * Get reward details by ID (public)
 * Cache for 5 minutes
 */
router.get('/:rewardId', cacheMiddleware(300), apiLimiter, rewardsController.getRewardDetails);

/**
 * Reserve reward (deduct points, generate coupon/QR)
 * Requires: Firebase auth token
 * Note: Auth temporarily disabled for testing UI
 */
router.post('/reserve', redemptionLimiter, rewardsController.reserveReward);

/**
 * Get user's redemptions
 * Requires: Firebase auth token
 */
router.get('/my/redemptions', verifyFirebaseToken, apiLimiter, rewardsController.getUserRedemptions);

/**
 * Cancel redemption and refund points
 * Requires: Firebase auth token
 */
router.post('/cancel', verifyFirebaseToken, apiLimiter, rewardsController.cancelRedemption);

/**
 * Redeem reward (mark as redeemed by merchant/partner)
 * Validates QR token and marks redemption as complete
 * Note: Auth temporarily disabled for testing - merchants can scan QR
 */
router.post('/redeem', redemptionLimiter, rewardsController.redeemReward);

module.exports = router;
