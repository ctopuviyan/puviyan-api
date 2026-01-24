/**
 * Script to list all organizations
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

const db = admin.firestore();

async function listOrganizations() {
  console.log('🏢 Listing all organizations...\n');

  try {
    const orgsSnapshot = await db.collection('organizations').get();
    
    if (orgsSnapshot.empty) {
      console.log('No organizations found.');
    } else {
      console.log(`Found ${orgsSnapshot.size} organizations:\n`);
      
      orgsSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`ID: ${doc.id}`);
        console.log(`Name: ${data.name}`);
        console.log(`Logo: ${data.logoUrl || 'N/A'}`);
        console.log(`Created: ${data.createdAt?.toDate?.() || 'N/A'}`);
        console.log('---\n');
      });
    }

  } catch (error) {
    console.error('❌ Error listing organizations:', error);
    process.exit(1);
  }

  process.exit(0);
}

listOrganizations();
