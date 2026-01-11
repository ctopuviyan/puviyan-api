const express = require('express');
const router = express.Router();

const { apiLimiter } = require('../middleware/rateLimit.middleware');
const { verifyPartnerFirebaseToken } = require('../middleware/partner-auth.middleware');
const partnerPortalController = require('../controllers/partner-portal.controller');

/**
 * Partner Portal - Get current partner user context
 * Requires: Partner Firebase Auth token
 */
router.get('/me', verifyPartnerFirebaseToken, apiLimiter, partnerPortalController.getMe);

/**
 * Create a new organization and bootstrap the requesting partner user
 * Requires: Partner Firebase Auth token
 */
router.post('/orgs', verifyPartnerFirebaseToken, apiLimiter, partnerPortalController.createOrg);

/**
 * Join an existing organization using invite code
 * Requires: Partner Firebase Auth token
 */
router.post('/orgs/join', verifyPartnerFirebaseToken, apiLimiter, partnerPortalController.joinOrg);

/**
 * Rotate (regenerate) an org invite code
 * Requires: Partner Firebase Auth token + partner_admin for that org
 */
router.post(
  '/orgs/:orgId/invite/rotate',
  verifyPartnerFirebaseToken,
  apiLimiter,
  partnerPortalController.rotateInviteCode
);

module.exports = router;
