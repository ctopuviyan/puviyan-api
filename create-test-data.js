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

async function createTestData() {
  console.log('🔧 Creating test data for Puviyan API...\n');

  try {
    // 1. Create a test partner
    const partnerId = 'test_cafe_001';
    const partnerApiKey = 'test_partner_key_12345'; // In production, use JWT

    const partnerData = {
      name: 'Test Cafe',
      logo: 'https://via.placeholder.com/150',
      category: 'cafe',
      location: {
        address: '123 Test Street',
        city: 'Chennai',
        coordinates: { lat: 13.0827, lng: 80.2707 }
      },
      redemptionRate: 10, // 10 points = ₹1
      isActive: true,
      apiKey: partnerApiKey,
      offers: [
        {
          offerId: 'offer_1',
          title: 'Get ₹50 off on orders above ₹500',
          minPoints: 500,
          maxDiscount: 50,
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
        }
      ],
      createdAt: new Date(),
      stats: {
        totalRedemptions: 0,
        totalPointsRedeemed: 0
      }
    };

    await db.collection('partners').doc(partnerId).set(partnerData);
    console.log('✅ Created test partner:', partnerId);
    console.log('   Partner API Key:', partnerApiKey);
    console.log('');

    // 2. Create test user with points (if you have a test user ID)
    // Note: You'll need to get a real Firebase Auth user ID
    console.log('📝 To test with a user:');
    console.log('   1. Sign in to your Flutter app');
    console.log('   2. Get your Firebase user ID');
    console.log('   3. Run this script with USER_ID environment variable');
    console.log('');

    const testUserId = process.env.TEST_USER_ID;
    if (testUserId) {
      const pointsData = {
        balance: 1000,
        earned: 1000,
        redeemed: 0,
        lastUpdated: new Date()
      };

      await db.collection('users').doc(testUserId).collection('points').doc('balance').set(pointsData);
      console.log('✅ Created test points for user:', testUserId);
      console.log('   Balance: 1000 points');
      console.log('');
    }

    // 3. Create a test offer
    const offerId = 'test_offer_001';
    const offerData = {
      offerId,
      partnerId,
      title: 'Test Cafe - ₹50 off',
      description: 'Get ₹50 discount on orders above ₹500',
      minPoints: 500,
      maxDiscount: 50,
      category: 'cafe',
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      isActive: true,
      termsAndConditions: 'Valid on all items. Cannot be combined with other offers.'
    };

    await db.collection('offers').doc(offerId).set(offerData);
    console.log('✅ Created test offer:', offerId);
    console.log('');

    console.log('🎉 Test data created successfully!');
    console.log('');
    console.log('📋 Quick Test Commands:');
    console.log('');
    console.log('1. Get all partners:');
    console.log('   curl http://localhost:8080/api/v1/partners');
    console.log('');
    console.log('2. Get partner details:');
    console.log(`   curl http://localhost:8080/api/v1/partners/${partnerId}`);
    console.log('');
    console.log('3. Get offers:');
    console.log('   curl http://localhost:8080/api/v1/points/offers');
    console.log('');
    console.log('4. Test redemption scan (with partner API key):');
    console.log(`   curl -X POST http://localhost:8080/api/v1/redemption/scan \\`);
    console.log(`     -H "x-partner-api-key: ${partnerApiKey}" \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"qrToken": "YOUR_QR_TOKEN"}'`);
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating test data:', error);
    process.exit(1);
  }
}

createTestData();
