const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin with staging credentials
const serviceAccount = require(path.join(__dirname, '..', 'service-account-stage.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'puviyan-stage'
});

const db = admin.firestore();

async function checkRewards() {
  try {
    console.log('🔍 Checking rewards in database...\n');
    
    const rewardsSnapshot = await db.collection('rewards')
      .where('rewardTitle', '==', 'COupon Based - Meal coupon test')
      .get();
    
    if (rewardsSnapshot.empty) {
      console.log('❌ Reward not found');
      
      // Show all rewards
      const allRewards = await db.collection('rewards').get();
      console.log(`\n📊 All rewards in database (${allRewards.size}):`);
      allRewards.docs.forEach(doc => {
        console.log(`  - ${doc.data().rewardTitle} (${doc.data().rewardType})`);
      });
      return;
    }
    
    rewardsSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      console.log('📦 Reward Data:');
      console.log(JSON.stringify(data, null, 2));
      console.log('\n🔑 Key Fields:');
      console.log(`  - rewardType: ${data.rewardType}`);
      console.log(`  - redemptionType: ${data.redemptionType || 'NOT SET ❌'}`);
      console.log(`  - mealType: ${data.mealType}`);
      console.log(`  - restaurantName: ${data.restaurantName}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

checkRewards();
