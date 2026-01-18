const signupService = require('../services/signup.service');
const { HTTP_STATUS } = require('../config/constants');

/**
 * Submit signup request (public endpoint)
 */
async function submitSignupRequest(req, res, next) {
  try {
    const { email, name, organizationName, reason } = req.body;
    
    const result = await signupService.submitSignupRequest({
      email,
      name,
      organizationName,
      reason,
    });
    
    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get all signup requests (Puviyan Admin only)
 */
async function getSignupRequests(req, res, next) {
  try {
    const { status, limit } = req.query;
    
    const requests = await signupService.getSignupRequests({
      status,
      limit: limit ? parseInt(limit) : 50,
    });
    
    res.status(HTTP_STATUS.OK).json({ requests });
  } catch (error) {
    next(error);
  }
}

/**
 * Approve signup request (Puviyan Admin only)
 */
async function approveSignupRequest(req, res, next) {
  try {
    const { requestId } = req.params;
    const { orgId, role } = req.body;
    const approvedBy = req.user.uid;
    
    const result = await signupService.approveSignupRequest({
      requestId,
      orgId,
      role,
      approvedBy,
    });
    
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Reject signup request (Puviyan Admin only)
 */
async function rejectSignupRequest(req, res, next) {
  try {
    const { requestId } = req.params;
    const { reason } = req.body;
    const rejectedBy = req.user.uid;
    
    const result = await signupService.rejectSignupRequest({
      requestId,
      rejectedBy,
      reason,
    });
    
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Generate signup link (Org Admin only)
 */
async function generateSignupLink(req, res, next) {
  try {
    const { email, name, role } = req.body;
    const createdBy = req.user.uid;
    
    // Get user's org from their partner user record
    const { getFirestore } = require('../config/firebase.config');
    const db = getFirestore();
    const partnerUserDoc = await db.collection('partnerUsers').doc(createdBy).get();
    
    if (!partnerUserDoc.exists) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'User not found' });
    }
    
    const partnerUser = partnerUserDoc.data();
    const orgId = partnerUser.orgId;
    
    if (!orgId) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'User not associated with an organization' });
    }
    
    const result = await signupService.generateSignupLink({
      email,
      name,
      orgId,
      role,
      createdBy,
    });
    
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Validate signup token (public endpoint)
 */
async function validateSignupToken(req, res, next) {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Token is required' });
    }
    
    const result = await signupService.validateSignupToken({ token });
    
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Complete signup (authenticated endpoint)
 */
async function completeSignup(req, res, next) {
  try {
    const { token } = req.body;
    const uid = req.user.uid;
    const email = req.user.email;
    
    const result = await signupService.completeSignup({
      token,
      uid,
      email,
    });
    
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Create Puviyan Admin manually (super admin endpoint)
 */
async function createPuviyanAdmin(req, res, next) {
  try {
    const { uid, email, name } = req.body;
    
    const result = await signupService.createPuviyanAdmin({
      uid,
      email,
      name,
    });
    
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get all organizations (Puviyan Admin only)
 */
async function getAllOrganizations(req, res, next) {
  try {
    const organizations = await signupService.getAllOrganizations();
    
    res.status(HTTP_STATUS.OK).json({ organizations });
  } catch (error) {
    next(error);
  }
}

/**
 * Create new organization (Puviyan Admin only)
 */
async function createOrganization(req, res, next) {
  try {
    const { name, orgId } = req.body;
    
    const result = await signupService.createOrganization({
      name,
      orgId,
      createdBy: req.user.uid,
    });
    
    res.status(HTTP_STATUS.CREATED).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get signup link details by ID (Puviyan Admin only)
 */
async function getSignupLink(req, res, next) {
  try {
    const { linkId } = req.params;
    
    const link = await signupService.getSignupLinkById(linkId);
    
    res.status(HTTP_STATUS.OK).json(link);
  } catch (error) {
    next(error);
  }
}

/**
 * Invite user - puviyan_admin can invite to any org, org_admin to their org only
 */
async function inviteUser(req, res, next) {
  try {
    const { email, name, orgId, role } = req.body;
    const createdBy = req.user.uid;
    const userRoles = req.user.roles || [];
    
    // Get user's partner user record
    const { getFirestore } = require('../config/firebase.config');
    const db = getFirestore();
    const partnerUserDoc = await db.collection('partnerUsers').doc(createdBy).get();
    
    if (!partnerUserDoc.exists) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'User not found' });
    }
    
    const partnerUser = partnerUserDoc.data();
    let targetOrgId = orgId;
    
    // If org_admin, they can only invite to their own org
    if (userRoles.includes('org_admin') && !userRoles.includes('puviyan_admin')) {
      if (!partnerUser.orgId) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'User not associated with an organization' });
      }
      targetOrgId = partnerUser.orgId;
      
      // If they provided an orgId, verify it matches their org
      if (orgId && orgId !== targetOrgId) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'You can only invite users to your own organization' });
      }
    }
    
    // puviyan_admin must provide an orgId
    if (userRoles.includes('puviyan_admin') && !targetOrgId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Organization ID is required' });
    }
    
    const result = await signupService.generateSignupLink({
      email,
      name,
      orgId: targetOrgId,
      role,
      createdBy,
    });
    
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  submitSignupRequest,
  getSignupRequests,
  approveSignupRequest,
  rejectSignupRequest,
  generateSignupLink,
  validateSignupToken,
  completeSignup,
  createPuviyanAdmin,
  getAllOrganizations,
  createOrganization,
  getSignupLink,
  inviteUser,
};
