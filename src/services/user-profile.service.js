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

  // Validate user exists
  const userDoc = await db.collection('informations').doc(userId).get();
  
  if (!userDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.USR_NOT_FOUND, 'User not found');
  }

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

    // Also update in Firestore informations collection
    const firestoreUpdates = {};
    if (updates.displayName !== undefined) {
      firestoreUpdates.name = updates.displayName;
    }
    if (updates.photoURL !== undefined) {
      firestoreUpdates.profilePicture = updates.photoURL;
    }
    
    if (Object.keys(firestoreUpdates).length > 0) {
      firestoreUpdates.updatedAt = new Date();
      await db.collection('informations').doc(userId).update(firestoreUpdates);
    }

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
