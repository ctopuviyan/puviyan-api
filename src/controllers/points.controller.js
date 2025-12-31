const pointsService = require('../services/points.service');
const { HTTP_STATUS } = require('../config/constants');

/**
 * Get user's points balance
 */
async function getPointsBalance(req, res, next) {
  try {
    const userId = req.user.uid;

    const result = await pointsService.getPointsBalance(userId);

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Calculate discount for given points
 */
async function calculateDiscount(req, res, next) {
  try {
    const { points, partnerId } = req.body;
    const userId = req.user.uid;

    const result = await pointsService.calculateDiscount({
      userId,
      points,
      partnerId
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get available offers
 */
async function getAvailableOffers(req, res, next) {
  try {
    const { partnerId, category } = req.query;

    const result = await pointsService.getAvailableOffers({
      partnerId,
      category
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Add points to user (for testing)
 */
async function addPoints(req, res, next) {
  try {
    const { userId, points, reason } = req.body;
    
    if (!userId || !points) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'userId and points are required'
      });
    }

    const result = await pointsService.addPoints(userId, points, reason || 'Testing');

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getPointsBalance,
  calculateDiscount,
  getAvailableOffers,
  addPoints
};
