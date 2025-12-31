const rewardsService = require('../services/rewards.service');
const { HTTP_STATUS } = require('../config/constants');

/**
 * Get all available rewards
 */
async function getAvailableRewards(req, res, next) {
  try {
    const { category, rewardType, status, limit = 20, offset = 0, userId } = req.query;

    const result = await rewardsService.getAvailableRewards({
      category,
      rewardType,
      status,
      limit: parseInt(limit),
      offset: parseInt(offset),
      userId // Pass userId to filter org-specific rewards
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get reward details
 */
async function getRewardDetails(req, res, next) {
  try {
    const { rewardId } = req.params;

    const result = await rewardsService.getRewardDetails(rewardId);

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Reserve reward
 */
async function reserveReward(req, res, next) {
  try {
    const { rewardId, userId } = req.body;
    // For testing: accept userId from body, for production: use req.user.uid
    const actualUserId = req.user?.uid || userId;

    if (!actualUserId) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'userId is required (in body for testing, or via auth token for production)'
      });
    }

    const result = await rewardsService.reserveReward({
      userId: actualUserId,
      rewardId
    });

    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get user's redemptions
 */
async function getUserRedemptions(req, res, next) {
  try {
    const userId = req.user.uid;
    const { status, limit = 20, offset = 0 } = req.query;

    const result = await rewardsService.getUserRedemptions({
      userId,
      status,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Cancel redemption
 */
async function cancelRedemption(req, res, next) {
  try {
    const { redemptionId, reason } = req.body;
    const userId = req.user.uid;

    const result = await rewardsService.cancelRedemption({
      userId,
      redemptionId,
      reason
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAvailableRewards,
  getRewardDetails,
  reserveReward,
  getUserRedemptions,
  cancelRedemption
};
