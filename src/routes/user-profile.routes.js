const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { apiLimiter } = require('../middleware/rateLimit.middleware');
const userProfileController = require('../controllers/user-profile.controller');

/**
 * Update user profile
 */
router.put('/profile', verifyFirebaseToken, apiLimiter, userProfileController.updateUserProfile);

module.exports = router;
