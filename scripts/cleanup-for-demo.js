/**
 * Script to clean up data for demo
 * Keeps puviyan_admin users, removes everything else
 * 
 * Usage: node scripts/cleanup-for-demo.js [--dry-run]
 */

require('dotenv').config({ path: '.env.stage' });
const { initializeFirebase, initializePartnerFirebase, getFirestore, getPartnerAuth } = require('../src/config/firebase.config');

// Initialize Firebase
initializeFirebase();
initializePartnerFirebase();
const db = getFirestore();
const partnerAuth = getPartnerAuth();

const DRY_RUN = process.argv.includes('--dry-run');

async function cleanupForDemo() {
  console.log('🧹 Starting cleanup for demo...');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'LIVE (will delete data)'}`);
  console.log('');

  try {
    // 1. Get all puviyan_admin UIDs to preserve them
    console.log('📋 Step 1: Finding puviyan_admin users to preserve...');
    const partnerUsersSnapshot = await db.collection('partnerUsers').get();
    const puviyanAdminUids = [];
    const usersToDelete = [];

    partnerUsersSnapshot.forEach(doc => {
      const data = doc.data();
      const roles = data.roles || [];
      
      if (roles.includes('puviyan_admin')) {
        puviyanAdminUids.push(doc.id);
        console.log(`  ✅ Preserving puviyan_admin: ${data.email} (${doc.id})`);
      } else {
        usersToDelete.push({ uid: doc.id, email: data.email, orgId: data.orgId });
        console.log(`  ❌ Will delete: ${data.email} (${doc.id})`);
      }
    });

    console.log(`\nFound ${puviyanAdminUids.length} puviyan_admin(s) to preserve`);
    console.log(`Found ${usersToDelete.length} user(s) to delete`);
    console.log('');

    // 2. Delete non-admin partnerUsers
    console.log('📋 Step 2: Deleting non-admin partnerUsers...');
    if (!DRY_RUN) {
      for (const user of usersToDelete) {
        await db.collection('partnerUsers').doc(user.uid).delete();
        console.log(`  ✅ Deleted partnerUser: ${user.email}`);
      }
    } else {
      console.log(`  [DRY RUN] Would delete ${usersToDelete.length} partnerUsers`);
    }
    console.log('');

    // 3. Delete from Firebase Authentication
    console.log('📋 Step 3: Deleting users from Firebase Authentication...');
    if (!DRY_RUN) {
      for (const user of usersToDelete) {
        try {
          await partnerAuth.deleteUser(user.uid);
          console.log(`  ✅ Deleted from auth: ${user.email}`);
        } catch (error) {
          console.log(`  ⚠️  Failed to delete from auth: ${user.email} - ${error.message}`);
        }
      }
    } else {
      console.log(`  [DRY RUN] Would delete ${usersToDelete.length} users from auth`);
    }
    console.log('');

    // 4. Delete organizations
    console.log('📋 Step 4: Deleting organizations...');
    const orgsSnapshot = await db.collection('organizations').get();
    console.log(`Found ${orgsSnapshot.size} organization(s)`);
    
    if (!DRY_RUN) {
      for (const orgDoc of orgsSnapshot.docs) {
        const orgId = orgDoc.id;
        const orgData = orgDoc.data();
        
        // Delete employees subcollection
        const employeesSnapshot = await db.collection('organizations').doc(orgId).collection('employees').get();
        for (const empDoc of employeesSnapshot.docs) {
          await empDoc.ref.delete();
        }
        console.log(`  ✅ Deleted ${employeesSnapshot.size} employees from ${orgData.name}`);
        
        // Delete organization
        await orgDoc.ref.delete();
        console.log(`  ✅ Deleted organization: ${orgData.name} (${orgId})`);
      }
    } else {
      console.log(`  [DRY RUN] Would delete ${orgsSnapshot.size} organizations`);
    }
    console.log('');

    // 5. Delete signup requests
    console.log('📋 Step 5: Deleting signup requests...');
    const requestsSnapshot = await db.collection('signupRequests').get();
    console.log(`Found ${requestsSnapshot.size} signup request(s)`);
    
    if (!DRY_RUN) {
      for (const doc of requestsSnapshot.docs) {
        await doc.ref.delete();
      }
      console.log(`  ✅ Deleted all signup requests`);
    } else {
      console.log(`  [DRY RUN] Would delete ${requestsSnapshot.size} signup requests`);
    }
    console.log('');

    // 6. Delete signup links
    console.log('📋 Step 6: Deleting signup links...');
    const linksSnapshot = await db.collection('signupLinks').get();
    console.log(`Found ${linksSnapshot.size} signup link(s)`);
    
    if (!DRY_RUN) {
      for (const doc of linksSnapshot.docs) {
        await doc.ref.delete();
      }
      console.log(`  ✅ Deleted all signup links`);
    } else {
      console.log(`  [DRY RUN] Would delete ${linksSnapshot.size} signup links`);
    }
    console.log('');

    // 7. Delete rewards (optional)
    console.log('📋 Step 7: Deleting rewards...');
    const rewardsSnapshot = await db.collection('rewards').get();
    console.log(`Found ${rewardsSnapshot.size} reward(s)`);
    
    if (!DRY_RUN) {
      for (const doc of rewardsSnapshot.docs) {
        await doc.ref.delete();
      }
      console.log(`  ✅ Deleted all rewards`);
    } else {
      console.log(`  [DRY RUN] Would delete ${rewardsSnapshot.size} rewards`);
    }
    console.log('');

    // 8. Delete redemptions (optional)
    console.log('📋 Step 8: Deleting redemptions...');
    const redemptionsSnapshot = await db.collection('redemptions').get();
    console.log(`Found ${redemptionsSnapshot.size} redemption(s)`);
    
    if (!DRY_RUN) {
      for (const doc of redemptionsSnapshot.docs) {
        await doc.ref.delete();
      }
      console.log(`  ✅ Deleted all redemptions`);
    } else {
      console.log(`  [DRY RUN] Would delete ${redemptionsSnapshot.size} redemptions`);
    }
    console.log('');

    console.log('✅ Cleanup completed!');
    console.log('');
    console.log('Summary:');
    console.log(`  - Preserved: ${puviyanAdminUids.length} puviyan_admin user(s)`);
    console.log(`  - Deleted: ${usersToDelete.length} non-admin user(s)`);
    console.log(`  - Deleted: ${orgsSnapshot.size} organization(s)`);
    console.log(`  - Deleted: ${requestsSnapshot.size} signup request(s)`);
    console.log(`  - Deleted: ${linksSnapshot.size} signup link(s)`);
    console.log(`  - Deleted: ${rewardsSnapshot.size} reward(s)`);
    console.log(`  - Deleted: ${redemptionsSnapshot.size} redemption(s)`);

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  } finally {
    process.exit(0);
  }
}

cleanupForDemo();
