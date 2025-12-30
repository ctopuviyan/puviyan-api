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

module.exports = {
  getPointsBalance,
  calculateDiscount,
  getAvailableOffers
};
