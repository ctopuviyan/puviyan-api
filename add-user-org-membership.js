const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./service-account-stage.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function addOrgMembership() {
  const userId = 'EIoY80zbSaXKWwPEFn59IepWgfu2';
  const orgId = 'ARIMA3733';
  const orgName = 'Arima';
  
  console.log(`\n🔧 Adding orgMembership to user: ${userId}`);
  console.log(`Organization: ${orgName} (${orgId})\n`);
  
  try {
    // Update user document with orgMembership
    await db.collection('informations').doc(userId).update({
      orgMembership: {
        orgId: orgId,
        orgName: orgName,
        role: 'member',
        joinedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    });
    
    console.log('✅ Successfully added orgMembership to user!');
    
    // Verify the update
    const userDoc = await db.collection('informations').doc(userId).get();
    const userData = userDoc.data();
    
    console.log('\n✅ Verification:');
    console.log(`- User: ${userData.name || userId}`);
    console.log(`- orgId: ${userData.orgMembership?.orgId}`);
    console.log(`- orgName: ${userData.orgMembership?.orgName}`);
    console.log(`- role: ${userData.orgMembership?.role}`);
    console.log(`- joinedAt: ${userData.orgMembership?.joinedAt?.toDate?.()}`);
    
    console.log('\n✅ The user should now be able to see org-specific rewards with orgId: ' + orgId);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

addOrgMembership();
