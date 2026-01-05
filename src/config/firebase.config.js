const admin = require('firebase-admin');
const path = require('path');

let firebaseApp = null;

/**
 * Initialize Firebase Admin SDK
 */
function initializeFirebase() {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    let credential;
    
    // Try to load service account file if path is provided
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
    
    if (serviceAccountPath) {
      try {
        const serviceAccount = require(path.resolve(serviceAccountPath));
        credential = admin.credential.cert(serviceAccount);
        console.log('✅ Using service account credentials from file');
      } catch (fileError) {
        console.log('⚠️ Service account file not found, using Application Default Credentials');
        credential = admin.credential.applicationDefault();
      }
    } else {
      // Use Application Default Credentials (for Cloud Run)
      console.log('✅ Using Application Default Credentials');
      credential = admin.credential.applicationDefault();
    }

    firebaseApp = admin.initializeApp({
      credential: credential,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`
    });

    console.log('✅ Firebase Admin SDK initialized successfully');
    return firebaseApp;
  } catch (error) {
    console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
    throw error;
  }
}

/**
 * Get Firestore instance
 */
function getFirestore() {
  if (!firebaseApp) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return admin.firestore();
}

/**
 * Get Firebase Auth instance
 */
function getAuth() {
  if (!firebaseApp) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return admin.auth();
}

module.exports = {
  initializeFirebase,
  getFirestore,
  getAuth,
  admin
};
