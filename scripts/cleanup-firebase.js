/**
 * Cleanup script to remove all users and organizations except puviyan_admin
 * Usage: GOOGLE_APPLICATION_CREDENTIALS=./service-account-stage.json node scripts/cleanup-firebase.js
 */

const admin = require('firebase-admin');
require('dotenv').config({ path: '.env.stage' });

// Initialize Firebase app using Application Default Credentials
const app = admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.PARTNER_FIREBASE_PROJECT_ID || 'puviyan-partner-stage',
});

const db = app.firestore();
const auth = app.auth();

async function cleanupFirebase() {
  console.log('🧹 Starting Firebase cleanup...\n');

  try {
    // Step 1: Get puviyan_admin user to preserve
    console.log('📋 Finding puviyan_admin user...');
    const partnerUsersSnapshot = await db.collection('partnerUsers').get();
    
    let puviyanAdminUid = null;
    let puviyanAdminEmail = null;
    
    partnerUsersSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.roles && data.roles.includes('puviyan_admin')) {
        puviyanAdminUid = doc.id;
        puviyanAdminEmail = data.email;
        console.log(`✅ Found puviyan_admin: ${puviyanAdminEmail} (${puviyanAdminUid})\n`);
      }
    });

    if (!puviyanAdminUid) {
      console.log('⚠️  No puviyan_admin user found. Aborting cleanup.');
      return;
    }

    // Step 2: Delete all organizations
    console.log('🗑️  Deleting organizations...');
    const orgsSnapshot = await db.collection('organizations').get();
    let orgCount = 0;
    
    for (const doc of orgsSnapshot.docs) {
      // Delete all employees in this organization
      const employeesSnapshot = await doc.ref.collection('employees').get();
      for (const empDoc of employeesSnapshot.docs) {
        await empDoc.ref.delete();
      }
      
      await doc.ref.delete();
      orgCount++;
      console.log(`  Deleted organization: ${doc.id} (${doc.data().name || 'unnamed'})`);
    }
    console.log(`✅ Deleted ${orgCount} organizations\n`);

    // Step 3: Delete all partnerUsers except puviyan_admin
    console.log('🗑️  Deleting partner users (except puviyan_admin)...');
    let userCount = 0;
    
    for (const doc of partnerUsersSnapshot.docs) {
      if (doc.id !== puviyanAdminUid) {
        await doc.ref.delete();
        userCount++;
        console.log(`  Deleted user: ${doc.data().email || doc.id}`);
      }
    }
    console.log(`✅ Deleted ${userCount} partner users\n`);

    // Step 4: Delete all signup requests
    console.log('🗑️  Deleting signup requests...');
    const requestsSnapshot = await db.collection('signupRequests').get();
    let requestCount = 0;
    
    for (const doc of requestsSnapshot.docs) {
      await doc.ref.delete();
      requestCount++;
    }
    console.log(`✅ Deleted ${requestCount} signup requests\n`);

    // Step 5: Delete all signup links
    console.log('🗑️  Deleting signup links...');
    const linksSnapshot = await db.collection('signupLinks').get();
    let linkCount = 0;
    
    for (const doc of linksSnapshot.docs) {
      await doc.ref.delete();
      linkCount++;
    }
    console.log(`✅ Deleted ${linkCount} signup links\n`);

    // Step 6: Delete all Firebase Auth users except puviyan_admin
    console.log('🗑️  Deleting Firebase Auth users (except puviyan_admin)...');
    let authUserCount = 0;
    let nextPageToken;
    
    do {
      const listUsersResult = await auth.listUsers(1000, nextPageToken);
      
      for (const userRecord of listUsersResult.users) {
        if (userRecord.uid !== puviyanAdminUid) {
          await auth.deleteUser(userRecord.uid);
          authUserCount++;
          console.log(`  Deleted auth user: ${userRecord.email || userRecord.uid}`);
        }
      }
      
      nextPageToken = listUsersResult.pageToken;
    } while (nextPageToken);
    
    console.log(`✅ Deleted ${authUserCount} auth users\n`);

    // Summary
    console.log('✅ Cleanup completed successfully!\n');
    console.log('📊 Summary:');
    console.log(`  - Organizations deleted: ${orgCount}`);
    console.log(`  - Partner users deleted: ${userCount}`);
    console.log(`  - Signup requests deleted: ${requestCount}`);
    console.log(`  - Signup links deleted: ${linkCount}`);
    console.log(`  - Auth users deleted: ${authUserCount}`);
    console.log(`  - Preserved: ${puviyanAdminEmail} (puviyan_admin)\n`);

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    // Cleanup
    await app.delete();
  }
}

// Run cleanup
cleanupFirebase()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
