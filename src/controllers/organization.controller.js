const organizationService = require('../services/organization.service');
const { HTTP_STATUS } = require('../config/constants');

/**
 * Get all organizations (admin only)
 */
async function getAllOrganizations(req, res, next) {
  try {
    const result = await organizationService.getAllOrganizations();
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get organization by ID
 */
async function getOrganizationById(req, res, next) {
  try {
    const { orgId } = req.params;
    const result = await organizationService.getOrganizationById(orgId);
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get current user's organization
 */
async function getMyOrganization(req, res, next) {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
    }
    
    const result = await organizationService.getMyOrganization(userId);
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Update organization
 */
async function updateOrganization(req, res, next) {
  try {
    const { orgId } = req.params;
    const updates = req.body;
    const updatedBy = req.user?.uid || 'system';

    const result = await organizationService.updateOrganization(orgId, updates, updatedBy);
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Create organization
 */
async function createOrganization(req, res, next) {
  try {
    const orgData = req.body;
    const createdBy = req.user?.uid || 'system';

    const result = await organizationService.createOrganization(orgData, createdBy);
    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllOrganizations,
  getOrganizationById,
  getMyOrganization,
  updateOrganization,
  createOrganization
};
