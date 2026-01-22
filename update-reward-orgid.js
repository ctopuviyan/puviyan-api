const admin = require('firebase-admin');
const path = require('path');

// Load environment
require('dotenv').config({ path: path.resolve(__dirname, '.env.stage') });

// Initialize Firebase Admin
const serviceAccount = require('./service-account-stage.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function updateRewardOrgId() {
  const rewardId = 'BAAVG5HBw76xj37Jk6fW';
  const orgId = 'PUVIY3596'; // Puviyan Digital Solution
  
  try {
    await db.collection('rewards').doc(rewardId).update({
      orgId: orgId,
      updatedAt: new Date().toISOString()
    });
    
    console.log(`✅ Updated reward ${rewardId} with orgId: ${orgId}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating reward:', error);
    process.exit(1);
  }
}

updateRewardOrgId();
