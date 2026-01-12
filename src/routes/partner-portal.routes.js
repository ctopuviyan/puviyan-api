const express = require('express');
const router = express.Router();
const multer = require('multer');

const { apiLimiter } = require('../middleware/rateLimit.middleware');
const { verifyPartnerFirebaseToken } = require('../middleware/partner-auth.middleware');
const partnerPortalController = require('../controllers/partner-portal.controller');
const employeeManagementController = require('../controllers/employee-management.controller');

// Configure multer for CSV uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

/**
 * Partner Portal - Get current partner user context
 * Requires: Partner Firebase Auth token
 */
router.get('/me', verifyPartnerFirebaseToken, apiLimiter, partnerPortalController.getMe);

/**
 * Partner Portal - Get dashboard metrics
 * Requires: Partner Firebase Auth token
 */
router.get('/dashboard/metrics', verifyPartnerFirebaseToken, apiLimiter, partnerPortalController.getDashboardMetrics);

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
 * Get users for a specific organization
 * Requires: Partner Firebase Auth token
 */
router.get('/orgs/:orgId/users', verifyPartnerFirebaseToken, apiLimiter, partnerPortalController.getOrgUsers);

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

/**
 * Upload CSV to bulk onboard employees
 * Requires: Partner Firebase Auth token + access to org
 */
router.post(
  '/orgs/:orgId/employees/upload',
  verifyPartnerFirebaseToken,
  apiLimiter,
  upload.single('file'),
  employeeManagementController.uploadEmployeeCSV
);

/**
 * Get employees for an organization
 * Requires: Partner Firebase Auth token + access to org
 */
router.get(
  '/orgs/:orgId/employees',
  verifyPartnerFirebaseToken,
  apiLimiter,
  employeeManagementController.getEmployees
);

/**
 * List available organizations for linking
 * Requires: Partner Firebase Auth token
 */
router.get(
  '/organizations',
  verifyPartnerFirebaseToken,
  apiLimiter,
  partnerPortalController.listAvailableOrganizations
);

/**
 * Request to link to an organization
 * Requires: Partner Firebase Auth token
 */
router.post(
  '/organizations/link',
  verifyPartnerFirebaseToken,
  apiLimiter,
  partnerPortalController.requestOrgLink
);

/**
 * Get partner's organization link requests
 * Requires: Partner Firebase Auth token
 */
router.get(
  '/organizations/link-requests',
  verifyPartnerFirebaseToken,
  apiLimiter,
  partnerPortalController.getOrgLinkRequests
);

/**
 * Get pending org link requests for admin's organization
 * Requires: Partner Firebase Auth token (partner_admin role)
 */
router.get(
  '/admin/pending-requests',
  verifyPartnerFirebaseToken,
  apiLimiter,
  partnerPortalController.getPendingOrgLinkRequests
);

/**
 * Approve an org link request
 * Requires: Partner Firebase Auth token (partner_admin role)
 */
router.post(
  '/admin/approve-request',
  verifyPartnerFirebaseToken,
  apiLimiter,
  partnerPortalController.approveOrgLinkRequest
);

/**
 * Reject an org link request
 * Requires: Partner Firebase Auth token (partner_admin role)
 */
router.post(
  '/admin/reject-request',
  verifyPartnerFirebaseToken,
  apiLimiter,
  partnerPortalController.rejectOrgLinkRequest
);

module.exports = router;
