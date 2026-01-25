const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./service-account-stage.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkUserOrg() {
  const email = 'gogreentamizha@gmail.com';
  const expectedOrgId = 'ARIMA3733';
  
  console.log(`\n🔍 Checking user: ${email}`);
  console.log(`Expected orgId: ${expectedOrgId}\n`);
  
  try {
    // First, let's check all users with this orgId
    console.log(`\n📋 Listing all users with orgId: ${expectedOrgId}`);
    const orgUsersSnapshot = await db.collection('informations')
      .where('orgMembership.orgId', '==', expectedOrgId)
      .get();
    
    if (!orgUsersSnapshot.empty) {
      console.log(`✅ Found ${orgUsersSnapshot.size} user(s) with orgId ${expectedOrgId}:`);
      orgUsersSnapshot.docs.forEach(doc => {
        const data = doc.data();
        console.log(`  - ${data.email || data.name || doc.id}`);
      });
    } else {
      console.log(`❌ No users found with orgId: ${expectedOrgId}`);
    }
    
    // Find user by email
    console.log(`\n\n🔍 Searching for user by email: ${email}`);
    const usersSnapshot = await db.collection('informations')
      .where('email', '==', email)
      .limit(1)
      .get();
    
    if (usersSnapshot.empty) {
      console.log('❌ User not found in informations collection by email');
      
      // Try searching in users collection (Firebase Auth)
      console.log('\n🔍 Checking Firebase Auth users collection...');
      try {
        const userRecord = await admin.auth().getUserByEmail(email);
        console.log(`✅ Found user in Firebase Auth with UID: ${userRecord.uid}`);
        
        // Now check if this UID exists in informations
        const infoDoc = await db.collection('informations').doc(userRecord.uid).get();
        if (infoDoc.exists) {
          console.log(`✅ Found user document in informations with UID: ${userRecord.uid}`);
          const userData = infoDoc.data();
          
          console.log(`\nUser data:`);
          console.log(`- Email: ${userData.email || 'N/A'}`);
          console.log(`- Name: ${userData.name || 'N/A'}`);
          
          if (userData.orgMembership) {
            console.log(`\n✅ orgMembership exists:`);
            console.log(`- orgId: ${userData.orgMembership.orgId}`);
            console.log(`- orgName: ${userData.orgMembership.orgName || 'N/A'}`);
            
            if (userData.orgMembership.orgId === expectedOrgId) {
              console.log(`\n✅ ✅ ✅ MATCH! User's orgId matches expected orgId: ${expectedOrgId}`);
            } else {
              console.log(`\n❌ MISMATCH! User's orgId (${userData.orgMembership.orgId}) does NOT match expected orgId (${expectedOrgId})`);
            }
          } else {
            console.log(`\n❌ orgMembership field does NOT exist for this user`);
            console.log(`\n💡 To fix: Update user document ${userRecord.uid} with:`);
            console.log(`{`);
            console.log(`  orgMembership: {`);
            console.log(`    orgId: "${expectedOrgId}",`);
            console.log(`    orgName: "Arima",`);
            console.log(`    role: "member",`);
            console.log(`    joinedAt: admin.firestore.FieldValue.serverTimestamp()`);
            console.log(`  }`);
            console.log(`}`);
          }
        } else {
          console.log(`❌ User UID ${userRecord.uid} not found in informations collection`);
        }
      } catch (authError) {
        console.log(`❌ User not found in Firebase Auth: ${authError.message}`);
      }
      
      return;
    }
    
    const userDoc = usersSnapshot.docs[0];
    const userId = userDoc.id;
    const userData = userDoc.data();
    
    console.log(`✅ User found with ID: ${userId}`);
    console.log(`\nUser data:`);
    console.log(`- Email: ${userData.email}`);
    console.log(`- Name: ${userData.name || 'N/A'}`);
    
    if (userData.orgMembership) {
      console.log(`\n✅ orgMembership exists:`);
      console.log(`- orgId: ${userData.orgMembership.orgId}`);
      console.log(`- orgName: ${userData.orgMembership.orgName || 'N/A'}`);
      console.log(`- role: ${userData.orgMembership.role || 'N/A'}`);
      console.log(`- joinedAt: ${userData.orgMembership.joinedAt || 'N/A'}`);
      
      if (userData.orgMembership.orgId === expectedOrgId) {
        console.log(`\n✅ ✅ ✅ MATCH! User's orgId matches expected orgId: ${expectedOrgId}`);
      } else {
        console.log(`\n❌ MISMATCH! User's orgId (${userData.orgMembership.orgId}) does NOT match expected orgId (${expectedOrgId})`);
      }
    } else {
      console.log(`\n❌ orgMembership field does NOT exist for this user`);
      console.log(`\nTo fix this, you need to add orgMembership to the user document:`);
      console.log(`{`);
      console.log(`  orgMembership: {`);
      console.log(`    orgId: "${expectedOrgId}",`);
      console.log(`    orgName: "Arima",`);
      console.log(`    role: "member",`);
      console.log(`    joinedAt: new Date()`);
      console.log(`  }`);
      console.log(`}`);
    }
    
    // Check the reward
    console.log(`\n\n🎁 Checking rewards with orgId: ${expectedOrgId}`);
    const rewardsSnapshot = await db.collection('rewards')
      .where('orgId', '==', expectedOrgId)
      .where('status', '==', 'active')
      .get();
    
    if (rewardsSnapshot.empty) {
      console.log(`❌ No active rewards found with orgId: ${expectedOrgId}`);
    } else {
      console.log(`✅ Found ${rewardsSnapshot.size} active reward(s) with orgId: ${expectedOrgId}`);
      rewardsSnapshot.docs.forEach(doc => {
        const reward = doc.data();
        console.log(`\n  - ${reward.rewardTitle}`);
        console.log(`    ID: ${doc.id}`);
        console.log(`    Type: ${reward.rewardType}`);
        console.log(`    Points: ${reward.deductPoints}`);
        console.log(`    Valid until: ${reward.validTo?.toDate?.()}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

checkUserOrg();
