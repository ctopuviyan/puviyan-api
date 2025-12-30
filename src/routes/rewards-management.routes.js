const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { verifyPartnerKey } = require('../middleware/partner.middleware');
const { apiLimiter } = require('../middleware/rateLimit.middleware');
const rewardsManagementController = require('../controllers/rewards-management.controller');

/**
 * Rewards Management Routes
 * For partners/admins to create and manage rewards
 */

/**
 * Create new reward
 * Requires: Firebase auth token OR Partner API key
 */
router.post('/', apiLimiter, rewardsManagementController.createReward);

/**
 * Get all rewards (admin view with filters)
 * Requires: Firebase auth token OR Partner API key
 */
router.get('/', apiLimiter, rewardsManagementController.getAllRewardsAdmin);

/**
 * Update reward
 * Requires: Firebase auth token OR Partner API key
 */
router.put('/:rewardId', apiLimiter, rewardsManagementController.updateReward);

/**
 * Delete reward (soft delete)
 * Requires: Firebase auth token OR Partner API key
 */
router.delete('/:rewardId', apiLimiter, rewardsManagementController.deleteReward);

/**
 * Update reward stock (for coupon type)
 * Requires: Firebase auth token OR Partner API key
 */
router.patch('/:rewardId/stock', apiLimiter, rewardsManagementController.updateRewardStock);

/**
 * Get reward analytics
 * Requires: Firebase auth token OR Partner API key
 */
router.get('/:rewardId/analytics', apiLimiter, rewardsManagementController.getRewardAnalytics);

module.exports = router;
