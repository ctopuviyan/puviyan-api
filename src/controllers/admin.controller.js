const adminService = require('../services/admin.service');
const { HTTP_STATUS } = require('../config/constants');

/**
 * Create new partner
 */
async function createPartner(req, res, next) {
  try {
    const partnerData = req.body;
    // For testing: allow without auth, for production: require req.user.uid
    const adminUserId = req.user?.uid || 'test-admin';

    // TODO: Add admin role verification in production
    // if (!req.user || !req.user.isAdmin) {
    //   throw new ApiError(403, 'FORBIDDEN', 'Admin access required');
    // }

    const result = await adminService.createPartner(partnerData, adminUserId);

    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Update partner
 */
async function updatePartner(req, res, next) {
  try {
    const { partnerId } = req.params;
    const updates = req.body;
    const adminUserId = req.user.uid;

    const result = await adminService.updatePartner(partnerId, updates, adminUserId);

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Delete partner
 */
async function deletePartner(req, res, next) {
  try {
    const { partnerId } = req.params;
    const adminUserId = req.user.uid;

    const result = await adminService.deletePartner(partnerId, adminUserId);

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get system analytics
 */
async function getSystemAnalytics(req, res, next) {
  try {
    const { period = '30d' } = req.query;

    const result = await adminService.getSystemAnalytics(period);

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get all redemptions (admin view)
 */
async function getAllRedemptions(req, res, next) {
  try {
    const { limit = 100, offset = 0, status, partnerId, userId } = req.query;

    const result = await adminService.getAllRedemptions({
      limit: parseInt(limit),
      offset: parseInt(offset),
      status,
      partnerId,
      userId
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createPartner,
  updatePartner,
  deletePartner,
  getSystemAnalytics,
  getAllRedemptions
};
