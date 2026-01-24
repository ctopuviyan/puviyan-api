const userProfileService = require('../services/user-profile.service');
const { HTTP_STATUS } = require('../config/constants');

/**
 * Update user profile
 */
async function updateUserProfile(req, res, next) {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
    }

    const updates = req.body;
    const result = await userProfileService.updateUserProfile(userId, updates);
    
    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  updateUserProfile
};
