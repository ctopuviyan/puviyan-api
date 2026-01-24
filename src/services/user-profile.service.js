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

  // Check if user exists in partner_users collection
  const partnerUserDoc = await db.collection('partner_users').doc(userId).get();
  
  if (!partnerUserDoc.exists) {
    // Create partner_users document if it doesn't exist
    await db.collection('partner_users').doc(userId).set({
      createdAt: new Date(),
      updatedAt: new Date()
    });
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

    // Also update in Firestore partner_users collection
    const firestoreUpdates = {};
    if (updates.displayName !== undefined) {
      firestoreUpdates.displayName = updates.displayName;
    }
    if (updates.photoURL !== undefined) {
      firestoreUpdates.photoURL = updates.photoURL;
    }
    
    if (Object.keys(firestoreUpdates).length > 0) {
      firestoreUpdates.updatedAt = new Date();
      await db.collection('partner_users').doc(userId).update(firestoreUpdates);
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
