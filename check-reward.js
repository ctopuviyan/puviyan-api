const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./service-account-stage.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkReward() {
  const orgId = 'ARIMA3733';
  
  console.log(`\n🎁 Checking rewards with orgId: ${orgId}\n`);
  
  try {
    const rewardsSnapshot = await db.collection('rewards')
      .where('orgId', '==', orgId)
      .get();
    
    if (rewardsSnapshot.empty) {
      console.log(`❌ No rewards found with orgId: ${orgId}`);
      console.log(`\nMake sure you created the reward with orgId field set to: ${orgId}`);
    } else {
      console.log(`✅ Found ${rewardsSnapshot.size} reward(s) with orgId: ${orgId}\n`);
      
      rewardsSnapshot.docs.forEach(doc => {
        const reward = doc.data();
        const now = new Date();
        const validTo = reward.validTo?.toDate?.();
        const isExpired = validTo && validTo < now;
        
        console.log(`📦 Reward: ${reward.rewardTitle}`);
        console.log(`   ID: ${doc.id}`);
        console.log(`   Type: ${reward.rewardType}`);
        console.log(`   Status: ${reward.status}`);
        console.log(`   Points: ${reward.deductPoints}`);
        console.log(`   Valid until: ${validTo}`);
        console.log(`   Expired: ${isExpired ? '❌ YES' : '✅ NO'}`);
        console.log(`   orgId: ${reward.orgId}`);
        console.log(`   brandName: ${reward.brandName || 'N/A'}`);
        console.log('');
        
        if (reward.status !== 'active') {
          console.log(`   ⚠️  Warning: Reward status is "${reward.status}" - should be "active"`);
        }
        if (isExpired) {
          console.log(`   ⚠️  Warning: Reward has expired!`);
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

checkReward();
