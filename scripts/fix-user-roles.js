/**
 * Script to check and fix user roles
 * Usage: node scripts/fix-user-roles.js <email>
 */

require('dotenv').config({ path: '.env.stage' });
const { initializeFirebase, getFirestore } = require('../src/config/firebase.config');

// Initialize Firebase
initializeFirebase();
const db = getFirestore();

async function checkAndFixUserRoles(email) {
  try {
    console.log(`Checking user: ${email}`);
    
    // Find user by email
    const usersSnapshot = await db.collection('partnerUsers')
      .where('email', '==', email)
      .get();
    
    if (usersSnapshot.empty) {
      console.log('❌ User not found in partnerUsers collection');
      return;
    }
    
    const userDoc = usersSnapshot.docs[0];
    const userData = userDoc.data();
    
    console.log('\n📋 Current user data:');
    console.log('UID:', userDoc.id);
    console.log('Email:', userData.email);
    console.log('Name:', userData.name);
    console.log('OrgId:', userData.orgId);
    console.log('Roles:', userData.roles);
    console.log('Role (legacy):', userData.role);
    
    // Check if roles array exists and is not empty
    if (!userData.roles || userData.roles.length === 0) {
      console.log('\n⚠️  User has no roles assigned!');
      
      // Check if there's a signup link for this user
      const linksSnapshot = await db.collection('signupLinks')
        .where('email', '==', email)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      
      if (!linksSnapshot.empty) {
        const linkData = linksSnapshot.docs[0].data();
        console.log('\n📝 Found signup link with role:', linkData.role);
        
        // Fix the user's roles
        const { FieldValue } = require('../src/config/firebase.config');
        await db.collection('partnerUsers').doc(userDoc.id).update({
          roles: [linkData.role],
          updatedAt: FieldValue.serverTimestamp(),
        });
        
        console.log('✅ Updated user roles to:', [linkData.role]);
      } else {
        console.log('\n❌ No signup link found for this user');
        console.log('Please manually set the role. Example:');
        console.log(`await db.collection('partnerUsers').doc('${userDoc.id}').update({ roles: ['org_admin'] });`);
      }
    } else {
      console.log('\n✅ User has roles assigned correctly');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

// Get email from command line argument
const email = process.argv[2];

if (!email) {
  console.error('Usage: node scripts/fix-user-roles.js <email>');
  process.exit(1);
}

checkAndFixUserRoles(email);
