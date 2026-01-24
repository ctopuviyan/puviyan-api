/**
 * Script to list all users and their custom claims
 */

const admin = require('firebase-admin');
const path = require('path');

// Load environment
require('dotenv').config({ path: path.resolve(__dirname, '../.env.stage') });

// Initialize Firebase Admin
const serviceAccountPath = path.resolve(__dirname, '..', process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

async function listUsers() {
  console.log('📋 Listing all users...\n');

  try {
    const listUsersResult = await admin.auth().listUsers();
    const users = listUsersResult.users;

    console.log(`Found ${users.length} total users:\n`);

    for (const user of users) {
      console.log(`Email: ${user.email}`);
      console.log(`UID: ${user.uid}`);
      console.log(`Display Name: ${user.displayName || 'N/A'}`);
      
      const customClaims = user.customClaims || {};
      console.log(`Custom Claims:`, JSON.stringify(customClaims, null, 2));
      console.log('---\n');
    }

  } catch (error) {
    console.error('❌ Error listing users:', error);
    process.exit(1);
  }

  process.exit(0);
}

listUsers();
