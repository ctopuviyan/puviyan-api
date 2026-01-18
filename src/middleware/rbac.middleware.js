const { getFirestore } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('./error.middleware');

/**
 * Middleware to check if user has required role(s)
 * 
 * New role system:
 * - puviyan_admin: Super admin
 * - org_admin: Organization administrator
 * - org_analyst: Organization user
 */
function requireRole(allowedRoles) {
  return async (req, res, next) => {
    try {
      const uid = req.user?.uid;
      
      if (!uid) {
        throw new ApiError(HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_UNAUTHORIZED, 'Authentication required');
      }

      const db = getFirestore();
      const partnerUserDoc = await db.collection('partnerUsers').doc(uid).get();
      
      if (!partnerUserDoc.exists) {
        throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'User not found in system');
      }

      const partnerUser = partnerUserDoc.data();
      const userRoles = partnerUser.roles || [];

      // Check if user has any of the allowed roles
      const hasRole = allowedRoles.some(role => userRoles.includes(role));

      if (!hasRole) {
        throw new ApiError(
          HTTP_STATUS.FORBIDDEN, 
          ERROR_CODES.AUTH_FORBIDDEN, 
          `Access denied. Required role(s): ${allowedRoles.join(', ')}`
        );
      }

      // Attach user data to request for use in controllers
      req.partnerUser = partnerUser;
      
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Check if user is Puviyan Admin
 */
function isPuviyanAdmin(req) {
  const userRoles = req.partnerUser?.roles || [];
  return userRoles.includes('puviyan_admin');
}

/**
 * Check if user is Org Admin
 */
function isOrgAdmin(req) {
  const userRoles = req.partnerUser?.roles || [];
  return userRoles.includes('org_admin') || userRoles.includes('puviyan_admin');
}

/**
 * Check if user belongs to specific organization
 */
function requireOrgAccess(orgIdParam = 'orgId') {
  return async (req, res, next) => {
    try {
      const uid = req.user?.uid;
      const requestedOrgId = req.params[orgIdParam] || req.body.orgId;
      
      if (!uid) {
        throw new ApiError(HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_UNAUTHORIZED, 'Authentication required');
      }

      const db = getFirestore();
      const partnerUserDoc = await db.collection('partnerUsers').doc(uid).get();
      
      if (!partnerUserDoc.exists) {
        throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'User not found in system');
      }

      const partnerUser = partnerUserDoc.data();
      const userRoles = partnerUser.roles || [];

      // Puviyan admins have access to all orgs
      if (userRoles.includes('puviyan_admin')) {
        req.partnerUser = partnerUser;
        return next();
      }

      // Other users must belong to the org
      if (partnerUser.orgId !== requestedOrgId) {
        throw new ApiError(
          HTTP_STATUS.FORBIDDEN, 
          ERROR_CODES.AUTH_FORBIDDEN, 
          'Access denied to this organization'
        );
      }

      req.partnerUser = partnerUser;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  requireRole,
  isPuviyanAdmin,
  isOrgAdmin,
  requireOrgAccess,
};
