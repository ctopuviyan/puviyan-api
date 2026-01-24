const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin with staging credentials
const serviceAccount = require(path.join(__dirname, '..', 'service-account-stage.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'puviyan-stage'
});

const db = admin.firestore();

async function deleteAllRewards() {
  try {
    console.log('🗑️  Starting to delete all rewards from staging database...');
    
    const rewardsSnapshot = await db.collection('rewards').get();
    
    if (rewardsSnapshot.empty) {
      console.log('✅ No rewards found in database');
      return;
    }
    
    console.log(`📊 Found ${rewardsSnapshot.size} rewards to delete`);
    
    const batch = db.batch();
    let count = 0;
    
    rewardsSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
      count++;
      console.log(`  - Deleting reward: ${doc.id} (${doc.data().rewardTitle})`);
    });
    
    await batch.commit();
    
    console.log(`✅ Successfully deleted ${count} rewards from staging database`);
    console.log('🎉 Database is now clean and ready for fresh testing!');
    
  } catch (error) {
    console.error('❌ Error deleting rewards:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

deleteAllRewards();
