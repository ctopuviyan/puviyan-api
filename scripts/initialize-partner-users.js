/**
 * Script to initialize partner_users collection for existing partner portal users
 * This creates partner_users documents for users who have org_admin or puviyan_admin roles
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

async function initializePartnerUsers() {
  console.log('🚀 Starting partner_users initialization...\n');

  try {
    // Get all users from Firebase Auth
    const listUsersResult = await admin.auth().listUsers();
    const users = listUsersResult.users;

    console.log(`Found ${users.length} total users in Firebase Auth\n`);

    let partnerUsersCreated = 0;
    let partnerUsersUpdated = 0;

    for (const user of users) {
      const customClaims = user.customClaims || {};
      const roles = customClaims.roles || [];
      
      // Check if user is a partner portal user (has org_admin or puviyan_admin role)
      const isPartnerUser = roles.includes('org_admin') || roles.includes('puviyan_admin');
      
      if (isPartnerUser) {
        console.log(`Processing partner user: ${user.email}`);
        
        // Check if partner_users document exists
        const partnerUserRef = db.collection('partner_users').doc(user.uid);
        const partnerUserDoc = await partnerUserRef.get();
        
        const partnerUserData = {
          email: user.email,
          displayName: user.displayName || null,
          photoURL: user.photoURL || null,
          roles: roles,
          orgId: customClaims.orgId || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (!partnerUserDoc.exists) {
          // Create new document
          partnerUserData.createdAt = admin.firestore.FieldValue.serverTimestamp();
          await partnerUserRef.set(partnerUserData);
          console.log(`  ✅ Created partner_users document for ${user.email}`);
          partnerUsersCreated++;
        } else {
          // Update existing document
          await partnerUserRef.update(partnerUserData);
          console.log(`  ✅ Updated partner_users document for ${user.email}`);
          partnerUsersUpdated++;
        }
        
        if (customClaims.orgId) {
          console.log(`  📋 Organization ID: ${customClaims.orgId}`);
        } else {
          console.log(`  ⚠️  No organization ID found in custom claims`);
        }
        console.log('');
      }
    }

    console.log('\n✅ Initialization complete!');
    console.log(`📊 Summary:`);
    console.log(`   - Partner users created: ${partnerUsersCreated}`);
    console.log(`   - Partner users updated: ${partnerUsersUpdated}`);
    console.log(`   - Total partner users: ${partnerUsersCreated + partnerUsersUpdated}`);

  } catch (error) {
    console.error('❌ Error initializing partner_users:', error);
    process.exit(1);
  }

  process.exit(0);
}

// Run the script
initializePartnerUsers();
