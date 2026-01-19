const express = require('express');
const router = express.Router();
const signupController = require('../controllers/signup.controller');
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');

/**
 * Public routes
 */

// Get public list of organizations (no auth required)
router.get('/public/organizations', signupController.getPublicOrganizations);

// Submit signup request (no auth required)
router.post('/signup/request', signupController.submitSignupRequest);

// Validate signup token (no auth required)
router.get('/signup/validate', signupController.validateSignupToken);

/**
 * Authenticated routes
 */

// Complete signup (requires auth but no specific role)
router.post('/signup/complete', verifyFirebaseToken, signupController.completeSignup);

/**
 * Puviyan Admin routes
 */

// Get all signup requests (org_admin sees only their org's requests)
router.get('/admin/signup-requests', 
  verifyFirebaseToken, 
  requireRole(['puviyan_admin', 'org_admin']), 
  signupController.getSignupRequests
);

// Get all organizations (org_admin sees only their org)
router.get('/admin/organizations', 
  verifyFirebaseToken, 
  requireRole(['puviyan_admin', 'org_admin']), 
  signupController.getAllOrganizations
);

// Create new organization (puviyan_admin only)
router.post('/admin/organizations', 
  verifyFirebaseToken, 
  requireRole(['puviyan_admin']), 
  signupController.createOrganization
);

// Get signup link by ID (org_admin can see their org's links)
router.get('/admin/signup-links/:linkId', 
  verifyFirebaseToken, 
  requireRole(['puviyan_admin', 'org_admin']), 
  signupController.getSignupLink
);

// Approve signup request (org_admin can approve for their org)
router.post('/admin/signup-requests/:requestId/approve', 
  verifyFirebaseToken, 
  requireRole(['puviyan_admin', 'org_admin']), 
  signupController.approveSignupRequest
);

// Reject signup request (org_admin can reject for their org)
router.post('/admin/signup-requests/:requestId/reject', 
  verifyFirebaseToken, 
  requireRole(['puviyan_admin', 'org_admin']), 
  signupController.rejectSignupRequest
);

// Create Puviyan Admin manually
router.post('/admin/create-puviyan-admin', 
  verifyFirebaseToken, 
  requireRole(['puviyan_admin']), 
  signupController.createPuviyanAdmin
);

/**
 * Org Admin routes
 */

// Generate signup link for org users
router.post('/org/signup-link', 
  verifyFirebaseToken, 
  requireRole(['org_admin', 'puviyan_admin']), 
  signupController.generateSignupLink
);

// Invite user - puviyan_admin can invite to any org, org_admin to their org
router.post('/invite-user', 
  verifyFirebaseToken, 
  requireRole(['org_admin', 'puviyan_admin']), 
  signupController.inviteUser
);

module.exports = router;
