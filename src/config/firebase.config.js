const admin = require('firebase-admin');
const path = require('path');

let firebaseApp = null;
let partnerFirebaseApp = null;

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
 * Initialize Firebase Admin SDK for Partner Portal Auth
 * Used only for verifying ID tokens from the partner Firebase project.
 */
function initializePartnerFirebase() {
  if (partnerFirebaseApp) {
    return partnerFirebaseApp;
  }

  try {
    let credential;

    const serviceAccountPath =
      process.env.PARTNER_FIREBASE_SERVICE_ACCOUNT_PATH ||
      process.env.PARTNER_GOOGLE_APPLICATION_CREDENTIALS;

    if (serviceAccountPath) {
      try {
        const serviceAccount = require(path.resolve(serviceAccountPath));
        credential = admin.credential.cert(serviceAccount);
        console.log('✅ Using partner service account credentials from file');
      } catch (fileError) {
        console.log('⚠️ Partner service account file not found, using Application Default Credentials');
        credential = admin.credential.applicationDefault();
      }
    } else {
      console.log('✅ Using Application Default Credentials for partner auth');
      credential = admin.credential.applicationDefault();
    }

    const partnerProjectId = process.env.PARTNER_FIREBASE_PROJECT_ID;
    if (!partnerProjectId) {
      throw new Error('PARTNER_FIREBASE_PROJECT_ID is required for partner auth');
    }

    partnerFirebaseApp = admin.initializeApp(
      {
        credential,
        projectId: partnerProjectId,
      },
      'partner'
    );

    console.log('✅ Partner Firebase Admin SDK initialized successfully');
    return partnerFirebaseApp;
  } catch (error) {
    console.error('❌ Failed to initialize Partner Firebase Admin SDK:', error.message);
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

/**
 * Get Partner Firebase Auth instance
 */
function getPartnerAuth() {
  if (!partnerFirebaseApp) {
    throw new Error('Partner Firebase not initialized. Call initializePartnerFirebase() first.');
  }
  return partnerFirebaseApp.auth();
}

module.exports = {
  initializeFirebase,
  initializePartnerFirebase,
  getFirestore,
  getAuth,
  getPartnerAuth,
  admin,
  FieldValue: admin.firestore.FieldValue,
  Timestamp: admin.firestore.Timestamp
};
