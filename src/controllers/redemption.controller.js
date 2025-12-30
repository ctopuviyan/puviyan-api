const redemptionService = require('../services/redemption.service.unified');
const { HTTP_STATUS } = require('../config/constants');

/**
 * Initiate redemption (generate QR token)
 */
async function initiateRedemption(req, res, next) {
  try {
    const { points, partnerId } = req.body;
    const userId = req.user.uid;

    const result = await redemptionService.initiateRedemption({
      userId,
      points,
      partnerId
    });

    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Scan QR code (partner endpoint)
 */
async function scanRedemption(req, res, next) {
  try {
    const { qrToken } = req.body;
    const partnerId = req.partner.id;

    const result = await redemptionService.scanRedemption({
      qrToken,
      partnerId
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Calculate discount (for percent_off/amount_off rewards)
 */
async function calculateDiscount(req, res, next) {
  try {
    const { redemptionId, userId, billAmount } = req.body;
    const partnerId = req.partner.id;

    const result = await redemptionService.calculateDiscount({
      redemptionId,
      userId,
      billAmount
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Confirm redemption (after payment)
 */
async function confirmRedemption(req, res, next) {
  try {
    const { redemptionId, userId, partnerTransactionId, billAmount, appliedDiscount } = req.body;
    const partnerId = req.partner.id;

    const result = await redemptionService.confirmRedemption({
      redemptionId,
      userId,
      partnerId,
      partnerTransactionId,
      billAmount,
      appliedDiscount
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Rollback redemption
 */
async function rollbackRedemption(req, res, next) {
  try {
    const { redemptionId, userId, reason } = req.body;
    const partnerId = req.partner.id;

    const result = await redemptionService.rollbackRedemption({
      redemptionId,
      userId,
      partnerId,
      reason
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get user's redemption history
 */
async function getRedemptionHistory(req, res, next) {
  try {
    const userId = req.user.uid;
    const { limit = 20, offset = 0 } = req.query;

    const result = await redemptionService.getRedemptionHistory({
      userId,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get redemption details
 */
async function getRedemptionDetails(req, res, next) {
  try {
    const { redemptionId } = req.params;
    const userId = req.user.uid;

    const result = await redemptionService.getRedemptionDetails({
      redemptionId,
      userId
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  initiateRedemption,
  scanRedemption,
  calculateDiscount,
  confirmRedemption,
  rollbackRedemption,
  getRedemptionHistory,
  getRedemptionDetails
};
