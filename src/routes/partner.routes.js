const express = require('express');
const router = express.Router();
const { verifyPartnerKey } = require('../middleware/partner.middleware');
const { apiLimiter } = require('../middleware/rateLimit.middleware');
const partnerController = require('../controllers/partner.controller');

/**
 * Get all active partners (public endpoint)
 */
router.get('/', apiLimiter, partnerController.getAllPartners);

/**
 * Get partner details by ID (public endpoint)
 */
router.get('/:partnerId', apiLimiter, partnerController.getPartnerDetails);

/**
 * Get partner's redemption history
 * Requires: Partner API key
 */
router.get('/:partnerId/redemptions', verifyPartnerKey, partnerController.getPartnerRedemptions);

/**
 * Get partner analytics
 * Requires: Partner API key
 */
router.get('/:partnerId/analytics', verifyPartnerKey, partnerController.getPartnerAnalytics);

module.exports = router;
