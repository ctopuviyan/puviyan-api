const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { verifyPartnerKey } = require('../middleware/partner.middleware');
const { redemptionLimiter, partnerScanLimiter } = require('../middleware/rateLimit.middleware');
const redemptionController = require('../controllers/redemption.controller');

/**
 * User initiates redemption (generates QR code)
 * Requires: Firebase auth token
 */
router.post('/initiate', verifyFirebaseToken, redemptionLimiter, redemptionController.initiateRedemption);

/**
 * Partner scans QR code
 * Requires: Partner API key
 */
router.post('/scan', verifyPartnerKey, partnerScanLimiter, redemptionController.scanRedemption);

/**
 * Calculate discount (for percent_off/amount_off rewards)
 * Requires: Partner API key
 */
router.post('/calculate', verifyPartnerKey, redemptionController.calculateDiscount);

/**
 * Confirm redemption (after payment)
 * Requires: Partner API key
 */
router.post('/confirm', verifyPartnerKey, redemptionController.confirmRedemption);

/**
 * Rollback/cancel redemption
 * Requires: Partner API key
 */
router.post('/rollback', verifyPartnerKey, redemptionController.rollbackRedemption);

/**
 * Get user's redemption history
 * Requires: Firebase auth token
 */
router.get('/history', verifyFirebaseToken, redemptionController.getRedemptionHistory);

/**
 * Get redemption details by ID
 * Requires: Firebase auth token or Partner API key
 */
router.get('/:redemptionId', verifyFirebaseToken, redemptionController.getRedemptionDetails);

module.exports = router;
