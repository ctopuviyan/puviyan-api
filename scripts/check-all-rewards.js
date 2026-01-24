const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(__dirname, '..', 'service-account-stage.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'puviyan-stage'
});

const db = admin.firestore();

async function checkAllRewards() {
  try {
    console.log('🔍 Checking all rewards in database...\n');
    
    const rewardsSnapshot = await db.collection('rewards').get();
    
    rewardsSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📦 ${data.rewardTitle}`);
      console.log(`   Type: ${data.rewardType}`);
      console.log(`   Redemption Type: ${data.redemptionType || '❌ NOT SET'}`);
      if (data.mealType) console.log(`   Meal Type: ${data.mealType}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

checkAllRewards();
