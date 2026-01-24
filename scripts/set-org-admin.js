/**
 * Script to set a user as org_admin with organization ID
 * Usage: node scripts/set-org-admin.js <email> <orgId>
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

async function setOrgAdmin(email, orgId) {
  console.log(`🚀 Setting up org admin for ${email}...\n`);

  try {
    // Get user by email
    const userRecord = await admin.auth().getUserByEmail(email);
    console.log(`✅ Found user: ${userRecord.email} (${userRecord.uid})`);

    // Verify organization exists
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

    // Set custom claims
    const customClaims = {
      roles: ['org_admin'],
      orgId: orgId,
      orgName: orgData.name
    };

    await admin.auth().setCustomUserClaims(userRecord.uid, customClaims);
    console.log(`✅ Set custom claims:`, customClaims);

    // Create partner_users document
    const partnerUserData = {
      email: userRecord.email,
      displayName: userRecord.displayName || null,
      photoURL: userRecord.photoURL || null,
      roles: ['org_admin'],
      orgId: orgId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('partner_users').doc(userRecord.uid).set(partnerUserData);
    console.log(`✅ Created partner_users document`);

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
