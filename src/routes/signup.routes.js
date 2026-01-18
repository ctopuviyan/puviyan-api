const express = require('express');
const router = express.Router();
const signupController = require('../controllers/signup.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/rbac.middleware');

/**
 * Public routes
 */

// Submit signup request (no auth required)
router.post('/signup/request', signupController.submitSignupRequest);

// Validate signup token (no auth required)
router.get('/signup/validate', signupController.validateSignupToken);

/**
 * Authenticated routes
 */

// Complete signup (requires auth but no specific role)
router.post('/signup/complete', authenticateToken, signupController.completeSignup);

/**
 * Puviyan Admin routes
 */

// Get all signup requests
router.get('/admin/signup-requests', 
  authenticateToken, 
  requireRole(['puviyan_admin']), 
  signupController.getSignupRequests
);

// Approve signup request
router.post('/admin/signup-requests/:requestId/approve', 
  authenticateToken, 
  requireRole(['puviyan_admin']), 
  signupController.approveSignupRequest
);

// Reject signup request
router.post('/admin/signup-requests/:requestId/reject', 
  authenticateToken, 
  requireRole(['puviyan_admin']), 
  signupController.rejectSignupRequest
);

// Create Puviyan Admin manually
router.post('/admin/create-puviyan-admin', 
  authenticateToken, 
  requireRole(['puviyan_admin']), 
  signupController.createPuviyanAdmin
);

/**
 * Org Admin routes
 */

// Generate signup link for org users
router.post('/org/signup-link', 
  authenticateToken, 
  requireRole(['org_admin', 'puviyan_admin']), 
  signupController.generateSignupLink
);

module.exports = router;
