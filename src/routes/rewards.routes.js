const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { apiLimiter, redemptionLimiter } = require('../middleware/rateLimit.middleware');
const rewardsController = require('../controllers/rewards.controller');

/**
 * Get all available rewards (public)
 */
router.get('/', apiLimiter, rewardsController.getAvailableRewards);

/**
 * Get reward details by ID (public)
 */
router.get('/:rewardId', apiLimiter, rewardsController.getRewardDetails);

/**
 * Reserve reward (deduct points, generate coupon/QR)
 * Requires: Firebase auth token
 */
router.post('/reserve', verifyFirebaseToken, redemptionLimiter, rewardsController.reserveReward);

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

module.exports = router;
