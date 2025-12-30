const partnerService = require('../services/partner.service');
const { HTTP_STATUS } = require('../config/constants');

/**
 * Get all active partners
 */
async function getAllPartners(req, res, next) {
  try {
    const { category, city } = req.query;

    const result = await partnerService.getAllPartners({
      category,
      city
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get partner details
 */
async function getPartnerDetails(req, res, next) {
  try {
    const { partnerId } = req.params;

    const result = await partnerService.getPartnerDetails(partnerId);

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get partner's redemption history
 */
async function getPartnerRedemptions(req, res, next) {
  try {
    const { partnerId } = req.params;
    const { limit = 50, offset = 0, startDate, endDate } = req.query;

    // Verify partner owns this data
    if (req.partner.id !== partnerId) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        error: 'FORBIDDEN',
        message: 'Access denied to this partner data'
      });
    }

    const result = await partnerService.getPartnerRedemptions({
      partnerId,
      limit: parseInt(limit),
      offset: parseInt(offset),
      startDate,
      endDate
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get partner analytics
 */
async function getPartnerAnalytics(req, res, next) {
  try {
    const { partnerId } = req.params;
    const { period = '30d' } = req.query;

    // Verify partner owns this data
    if (req.partner.id !== partnerId) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        error: 'FORBIDDEN',
        message: 'Access denied to this partner data'
      });
    }

    const result = await partnerService.getPartnerAnalytics({
      partnerId,
      period
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllPartners,
  getPartnerDetails,
  getPartnerRedemptions,
  getPartnerAnalytics
};
