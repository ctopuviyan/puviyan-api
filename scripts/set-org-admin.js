/**
 * Script to set a user as org_admin with organization ID
 * Usage: node scripts/set-org-admin.js <email> <orgId>
 */

const admin = require('firebase-admin');
const path = require('path');

// Load environment
require('dotenv').config({ path: path.resolve(__dirname, '../.env.stage') });

// Initialize Consumer Firebase (for organizations)
const serviceAccountPath = path.resolve(__dirname, '..', process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
const serviceAccount = require(serviceAccountPath);

const consumerApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: process.env.FIREBASE_PROJECT_ID
});

// Initialize Partner Firebase (for partner_users and auth)
const partnerServiceAccountPath = path.resolve(__dirname, '..', process.env.PARTNER_FIREBASE_SERVICE_ACCOUNT_PATH || process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
const partnerServiceAccount = require(partnerServiceAccountPath);

const partnerApp = admin.initializeApp({
  credential: admin.credential.cert(partnerServiceAccount),
  projectId: process.env.PARTNER_FIREBASE_PROJECT_ID
}, 'partner');

const db = consumerApp.firestore(); // For organizations
const partnerDb = partnerApp.firestore(); // For partner_users
const partnerAuth = partnerApp.auth(); // For partner auth

async function setOrgAdmin(email, orgId) {
  console.log(`🚀 Setting up org admin for ${email}...\n`);

  try {
    // Get user by email from Partner Firebase
    const userRecord = await partnerAuth.getUserByEmail(email);
    console.log(`✅ Found user: ${userRecord.email} (${userRecord.uid})`);

    // Verify organization exists in Consumer Firebase
    const orgDoc = await db.collection('organizations').doc(orgId).get();
    if (!orgDoc.exists) {
      console.error(`❌ Organization ${orgId} not found!`);
      console.log('\nAvailable organizations:');
      const orgsSnapshot = await db.collection('organizations').get();
      orgsSnapshot.forEach(doc => {
        console.log(`  - ${doc.id}: ${doc.data().name}`);
      });
      process.exit(1);
    }

    const orgData = orgDoc.data();
    console.log(`✅ Found organization: ${orgData.name} (${orgId})`);

    // Set custom claims in Partner Firebase
    const customClaims = {
      roles: ['org_admin'],
      orgId: orgId,
      orgName: orgData.name
    };

    await partnerAuth.setCustomUserClaims(userRecord.uid, customClaims);
    console.log(`✅ Set custom claims:`, customClaims);

    // Create partner_users document in Partner Firestore
    const partnerUserData = {
      email: userRecord.email,
      displayName: userRecord.displayName || null,
      photoURL: userRecord.photoURL || null,
      roles: ['org_admin'],
      orgId: orgId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await partnerDb.collection('partner_users').doc(userRecord.uid).set(partnerUserData);
    console.log(`✅ Created partner_users document in Partner Firestore`);

    console.log('\n✅ Setup complete!');
    console.log(`\n⚠️  Important: User must log out and log back in for changes to take effect.`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

// Get command line arguments
const args = process.argv.slice(2);
if (args.length !== 2) {
  console.log('Usage: node scripts/set-org-admin.js <email> <orgId>');
  console.log('Example: node scripts/set-org-admin.js admin@example.com org123');
  process.exit(1);
}

const [email, orgId] = args;
setOrgAdmin(email, orgId);
