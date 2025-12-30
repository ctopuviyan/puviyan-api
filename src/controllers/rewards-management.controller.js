const rewardsManagementService = require('../services/rewards-management.service');
const { HTTP_STATUS } = require('../config/constants');

/**
 * Create new reward
 */
async function createReward(req, res, next) {
  try {
    const rewardData = req.body;
    const createdBy = req.user?.uid || req.partner?.id || 'system';

    const result = await rewardsManagementService.createReward(rewardData, createdBy);

    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Update reward
 */
async function updateReward(req, res, next) {
  try {
    const { rewardId } = req.params;
    const updates = req.body;
    const updatedBy = req.user?.uid || req.partner?.id || 'system';

    const result = await rewardsManagementService.updateReward(rewardId, updates, updatedBy);

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Delete reward
 */
async function deleteReward(req, res, next) {
  try {
    const { rewardId } = req.params;
    const deletedBy = req.user?.uid || req.partner?.id || 'system';

    const result = await rewardsManagementService.deleteReward(rewardId, deletedBy);

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get all rewards (admin view)
 */
async function getAllRewardsAdmin(req, res, next) {
  try {
    const { status, rewardType, brandName, partnerId, limit = 50, offset = 0 } = req.query;

    const result = await rewardsManagementService.getAllRewardsAdmin({
      status,
      rewardType,
      brandName,
      partnerId,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Update reward stock
 */
async function updateRewardStock(req, res, next) {
  try {
    const { rewardId } = req.params;
    const { totalCoupons } = req.body;
    const updatedBy = req.user?.uid || req.partner?.id || 'system';

    const result = await rewardsManagementService.updateRewardStock(rewardId, totalCoupons, updatedBy);

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get reward analytics
 */
async function getRewardAnalytics(req, res, next) {
  try {
    const { rewardId } = req.params;

    const result = await rewardsManagementService.getRewardAnalytics(rewardId);

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createReward,
  updateReward,
  deleteReward,
  getAllRewardsAdmin,
  updateRewardStock,
  getRewardAnalytics
};
