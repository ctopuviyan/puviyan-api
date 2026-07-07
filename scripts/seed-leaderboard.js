/**
 * Seed script to populate Firebase with mock leaderboard data
 * Usage: node scripts/seed-leaderboard.js
 */

const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

// Initialize Firebase
let serviceAccount;
try {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (serviceAccountPath) {
    serviceAccount = require(path.resolve(serviceAccountPath));
  }
} catch (e) {
  console.log('No service account file found');
}

if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
  console.log('✅ Firebase initialized with service account');
} else {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
  console.log('✅ Firebase initialized with Application Default Credentials');
}

const db = admin.firestore();

// Mock leaderboard data
const MOCK_LEADERBOARD = [
  {
    eventId: 'mock_event_1',
    users: [
      { userId: 'user_1', userName: 'John Doe', carbonScore: 150, points: 150 },
      { userId: 'user_2', userName: 'Jane Smith', carbonScore: 120, points: 120 },
      { userId: 'user_3', userName: 'Mike Johnson', carbonScore: 90, points: 90 },
      { userId: 'user_4', userName: 'Sarah Williams', carbonScore: 75, points: 75 },
      { userId: 'user_5', userName: 'David Brown', carbonScore: 50, points: 50 }
    ]
  },
  {
    eventId: 'mock_event_2',
    users: [
      { userId: 'user_6', userName: 'Emily Davis', carbonScore: 200, points: 200 },
      { userId: 'user_7', userName: 'Chris Wilson', carbonScore: 180, points: 180 },
      { userId: 'user_8', userName: 'Amanda Taylor', carbonScore: 150, points: 150 }
    ]
  }
];

async function seedLeaderboard() {
  try {
    console.log('🌱 Seeding leaderboard data to Firebase...');
    
    for (const eventLeaderboard of MOCK_LEADERBOARD) {
      const batch = db.batch();
      
      console.log(`   Adding leaderboard for event: ${eventLeaderboard.eventId}`);
      
      for (const user of eventLeaderboard.users) {
        const leaderboardRef = db
          .collection('events')
          .doc(eventLeaderboard.eventId)
          .collection('leaderboard')
          .doc(user.userId);
        
        const leaderboardData = {
          userId: user.userId,
          userName: user.userName,
          carbonScore: user.carbonScore,
          points: user.points,
          joinedAt: admin.firestore.Timestamp.fromDate(new Date())
        };
        
        batch.set(leaderboardRef, leaderboardData);
        console.log(`     - ${user.userName}: ${user.carbonScore} carbon score`);
      }
      
      await batch.commit();
    }
    
    console.log('✅ Successfully seeded leaderboard data to Firebase!');
    
  } catch (error) {
    console.error('❌ Error seeding leaderboard:', error);
    process.exit(1);
  }
}

seedLeaderboard().then(() => {
  process.exit(0);
});
