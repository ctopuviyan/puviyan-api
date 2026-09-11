const express = require('express');
const router = express.Router();
const {
  verifyFirebaseToken,
  verifyConsumerFirebaseToken
} = require('../middleware/auth.middleware');
const { apiLimiter, redemptionLimiter } = require('../middleware/rateLimit.middleware');
const { cacheMiddleware } = require('../middleware/cache.middleware');
const rewardsController = require('../controllers/rewards.controller');

/**
 * Get all available rewards (public)
 * Cache for 5 minutes
 */
router.get('/', cacheMiddleware(300), apiLimiter, rewardsController.getAvailableRewards);

/**
 * Get authoritative, user-specific digital badge state.
 * These routes must stay before /:rewardId so Express does not interpret
 * "digital-badges" as a reward ID.
 */
router.get('/digital-badges', verifyConsumerFirebaseToken, apiLimiter, rewardsController.getDigitalBadges);
router.get('/digital-badges/achieved', verifyConsumerFirebaseToken, apiLimiter, rewardsController.getAchievedDigitalBadges);
router.get('/digital-badges/users/:userId/achieved', verifyConsumerFirebaseToken, apiLimiter, rewardsController.getPublicAchievedDigitalBadges);
router.get('/digital-badges/:rewardId', verifyConsumerFirebaseToken, apiLimiter, rewardsController.getDigitalBadgeDetails);
router.post('/digital-badges/recalculate', verifyConsumerFirebaseToken, apiLimiter, rewardsController.recalculateDigitalBadges);

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

/**
 * Get reward details by ID (public)
 * Cache for 5 minutes. Keep the dynamic route last.
 */
router.get('/:rewardId', cacheMiddleware(300), apiLimiter, rewardsController.getRewardDetails);

module.exports = router;
