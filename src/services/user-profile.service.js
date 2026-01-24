const { getFirestore, admin } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');

/**
 * User Profile Service - Update user profile information
 */

/**
 * Update user profile (display name and photo URL)
 */
async function updateUserProfile(userId, updates) {
  const db = getFirestore();

  // Update Firebase Auth profile
  try {
    const updateData = {};
    
    if (updates.displayName !== undefined) {
      updateData.displayName = updates.displayName;
    }
    
    if (updates.photoURL !== undefined) {
      updateData.photoURL = updates.photoURL;
    }

    await admin.auth().updateUser(userId, updateData);

    // Update in Firestore partner_users collection using set with merge
    const firestoreUpdates = {
      updatedAt: new Date()
    };
    
    if (updates.displayName !== undefined) {
      firestoreUpdates.displayName = updates.displayName;
    }
    if (updates.photoURL !== undefined) {
      firestoreUpdates.photoURL = updates.photoURL;
    }
    
    // Use set with merge to create if doesn't exist, update if exists
    await db.collection('partner_users').doc(userId).set(firestoreUpdates, { merge: true });

    return {
      message: 'Profile updated successfully',
      displayName: updates.displayName,
      photoURL: updates.photoURL
    };
  } catch (error) {
    console.error('Error updating user profile:', error);
    throw new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_ERROR, 'Failed to update user profile');
  }
}

module.exports = {
  updateUserProfile
};
