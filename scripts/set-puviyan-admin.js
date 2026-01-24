/**
 * Script to set a user as puviyan_admin (super admin)
 * Usage: node scripts/set-puviyan-admin.js <email>
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

async function setPuviyanAdmin(email) {
  console.log(`🚀 Setting up Puviyan admin for ${email}...\n`);

  try {
    // Get user by email
    const userRecord = await admin.auth().getUserByEmail(email);
    console.log(`✅ Found user: ${userRecord.email} (${userRecord.uid})`);

    // Set custom claims
    const customClaims = {
      roles: ['puviyan_admin']
    };

    await admin.auth().setCustomUserClaims(userRecord.uid, customClaims);
    console.log(`✅ Set custom claims:`, customClaims);

    // Create partner_users document
    const partnerUserData = {
      email: userRecord.email,
      displayName: userRecord.displayName || null,
      photoURL: userRecord.photoURL || null,
      roles: ['puviyan_admin'],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('partner_users').doc(userRecord.uid).set(partnerUserData);
    console.log(`✅ Created partner_users document`);

    console.log('\n✅ Setup complete!');
    console.log(`\n⚠️  Important: User must log out and log back in for changes to take effect.`);
    console.log(`\nPuviyan admin can now:`);
    console.log(`  - View and manage ALL organizations`);
    console.log(`  - Create new organizations`);
    console.log(`  - Onboard employees to any organization`);
    console.log(`  - Access all admin features`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

// Get command line arguments
const args = process.argv.slice(2);
if (args.length !== 1) {
  console.log('Usage: node scripts/set-puviyan-admin.js <email>');
  console.log('Example: node scripts/set-puviyan-admin.js admin@puviyan.com');
  process.exit(1);
}

const [email] = args;
setPuviyanAdmin(email);
