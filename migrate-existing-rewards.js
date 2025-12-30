const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

// Initialize Firebase Admin
const serviceAccount = require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: process.env.FIREBASE_PROJECT_ID
});

const db = admin.firestore();

/**
 * Migration script to add new fields to existing rewards
 * This makes existing coupon rewards compatible with the new unified system
 */
async function migrateRewards() {
  console.log('🔄 Starting rewards migration...\n');

  try {
    // Get all existing rewards
    const rewardsSnapshot = await db.collection('rewards').get();

    if (rewardsSnapshot.empty) {
      console.log('❌ No rewards found in the collection');
      return;
    }

    console.log(`📦 Found ${rewardsSnapshot.size} rewards to migrate\n`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const doc of rewardsSnapshot.docs) {
      const rewardId = doc.id;
      const data = doc.data();

      console.log(`Processing: ${rewardId} - "${data.rewardTitle}"`);

      // Check if already migrated
      if (data.rewardType) {
        console.log(`  ⏭️  Already migrated (rewardType: ${data.rewardType})`);
        skippedCount++;
        continue;
      }

      // Prepare migration data
      const migrationData = {
        // Set default reward type to coupon
        rewardType: 'coupon',
        
        // Initialize new fields as null (for future use)
        discountPercent: null,
        maxDiscountAmount: null,
        minPurchaseAmount: null,
        discountAmount: null,
        
        // Partner linking (can be set later)
        partnerId: null,
        
        // Categories (derive from brandName or set empty)
        categories: [],
        
        // Terms (can be populated later)
        termsAndConditions: data.termsAndConditions || '',
        
        // Update timestamp
        updatedAt: new Date()
      };

      // Update the reward document
      await db.collection('rewards').doc(rewardId).update(migrationData);

      console.log(`  ✅ Migrated successfully`);
      migratedCount++;
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Migration Summary');
    console.log('='.repeat(50));
    console.log(`Total rewards: ${rewardsSnapshot.size}`);
    console.log(`✅ Migrated: ${migratedCount}`);
    console.log(`⏭️  Skipped (already migrated): ${skippedCount}`);
    console.log('');

    console.log('🎉 Migration completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Verify rewards in Firebase Console');
    console.log('2. Test the /api/v1/rewards endpoint');
    console.log('3. Create partners and link them to rewards');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateRewards();
