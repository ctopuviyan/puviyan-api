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

async function checkExistingRewards() {
  console.log('🔍 Checking existing rewards/points structure in Firestore...\n');

  try {
    // Check for various possible collection names
    const collectionsToCheck = [
      'rewards',
      'points',
      'userPoints',
      'user_points',
      'informationsPrivate' // Common in your app
    ];

    for (const collectionName of collectionsToCheck) {
      console.log(`\n📦 Checking collection: ${collectionName}`);
      console.log('─'.repeat(50));
      
      const snapshot = await db.collection(collectionName).limit(3).get();
      
      if (snapshot.empty) {
        console.log(`   ❌ Collection '${collectionName}' is empty or doesn't exist`);
        continue;
      }

      console.log(`   ✅ Found ${snapshot.size} documents (showing first 3)`);
      
      snapshot.forEach((doc, index) => {
        console.log(`\n   Document ${index + 1}: ${doc.id}`);
        const data = doc.data();
        console.log('   Fields:', Object.keys(data).join(', '));
        console.log('   Sample data:', JSON.stringify(data, null, 2).split('\n').map(line => '   ' + line).join('\n'));
      });
    }

    // Check for subcollections under users
    console.log('\n\n📦 Checking users subcollections');
    console.log('─'.repeat(50));
    
    const usersSnapshot = await db.collection('users').limit(1).get();
    
    if (!usersSnapshot.empty) {
      const userId = usersSnapshot.docs[0].id;
      console.log(`   Checking subcollections for user: ${userId}`);
      
      const subcollections = ['points', 'rewards', 'transactions'];
      
      for (const subcol of subcollections) {
        const subSnapshot = await db.collection('users').doc(userId).collection(subcol).limit(1).get();
        
        if (!subSnapshot.empty) {
          console.log(`\n   ✅ Found subcollection: users/{uid}/${subcol}`);
          const doc = subSnapshot.docs[0];
          console.log(`      Document ID: ${doc.id}`);
          console.log(`      Fields: ${Object.keys(doc.data()).join(', ')}`);
          console.log(`      Sample:`, JSON.stringify(doc.data(), null, 2).split('\n').map(line => '      ' + line).join('\n'));
        } else {
          console.log(`   ❌ Subcollection 'users/{uid}/${subcol}' not found`);
        }
      }
    } else {
      console.log('   ❌ No users found in users collection');
    }

    // Check informationsPrivate for points data
    console.log('\n\n📦 Checking informationsPrivate for points data');
    console.log('─'.repeat(50));
    
    const infoSnapshot = await db.collection('informationsPrivate').limit(1).get();
    
    if (!infoSnapshot.empty) {
      const doc = infoSnapshot.docs[0];
      const data = doc.data();
      console.log(`   User ID: ${doc.id}`);
      console.log(`   Fields: ${Object.keys(data).join(', ')}`);
      
      // Check if points-related fields exist
      const pointsFields = ['points', 'totalPoints', 'rewardPoints', 'balance', 'earned', 'redeemed'];
      const foundFields = pointsFields.filter(field => data.hasOwnProperty(field));
      
      if (foundFields.length > 0) {
        console.log(`   ✅ Found points-related fields: ${foundFields.join(', ')}`);
        console.log(`   Sample values:`, JSON.stringify(
          Object.fromEntries(foundFields.map(f => [f, data[f]])), 
          null, 
          2
        ).split('\n').map(line => '   ' + line).join('\n'));
      } else {
        console.log(`   ❌ No points-related fields found`);
      }
    }

    console.log('\n\n' + '='.repeat(50));
    console.log('📋 Summary');
    console.log('='.repeat(50));
    console.log('\nWhat the API expects:');
    console.log('  Collection: users/{uid}/points/balance');
    console.log('  Fields: { balance, earned, redeemed, lastUpdated }');
    console.log('\nOr alternatively:');
    console.log('  Collection: informationsPrivate/{uid}');
    console.log('  Fields: { points, totalPoints, etc. }');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkExistingRewards();
