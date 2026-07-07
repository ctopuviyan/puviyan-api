/**
 * Seed script to populate Firebase with mock events data
 * Usage: node scripts/seed-events.js
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

// Mock events data from events.service.js
const MOCK_EVENTS = [
  {
    eventId: 'mock_event_1',
    eventName: 'Beach Cleanup Drive',
    bannerUrl: 'https://example.com/banner1.jpg',
    eventMode: 'onsite',
    eventType: 'cleanup_water',
    eventVisibility: 'public',
    startDateTime: new Date(Date.now() + 86400000 * 7).toISOString(),
    endDateTime: new Date(Date.now() + 86400000 * 7 + 7200000).toISOString(),
    timeZone: 'Asia/Kolkata',
    location: { latitude: 13.0827, longitude: 80.2707, address: 'Marina Beach, Chennai' },
    aboutEvent: 'Join us for a beach cleanup drive to help protect our marine ecosystem.',
    spotsAvailable: 50,
    contributionUnit: 'kg of waste collected',
    co2eImpactPerUnit: 4,
    leaderboardEnabled: true,
    pointsFirstPlace: 500,
    pointsSecondPlace: 300,
    pointsThirdPlace: 100,
    pointsOthers: 50,
    hostId: 'host_123',
    hostName: 'Green Earth Foundation',
    ageRestriction: '18+',
    howItWorks: '1. Sign up for the event in the app.\n2. On the event date go to the event location.\n3. Check in within 100 metres of the event location during the event time.\n4. Participate and complete the activity.\n5. Earn your points and rewards.',
    status: 'published',
    orgId: null
  },
  {
    eventId: 'mock_event_2',
    eventName: 'Tree Plantation Workshop',
    bannerUrl: 'https://example.com/banner2.jpg',
    eventMode: 'onsite',
    eventType: 'tree_plantation',
    eventVisibility: 'public',
    startDateTime: new Date(Date.now() + 86400000 * 14).toISOString(),
    endDateTime: new Date(Date.now() + 86400000 * 14 + 10800000).toISOString(),
    timeZone: 'Asia/Kolkata',
    location: { latitude: 12.9716, longitude: 77.5946, address: 'Cubbon Park, Bangalore' },
    aboutEvent: 'Learn about native tree species and help plant trees in our community park.',
    spotsAvailable: 30,
    contributionUnit: 'Trees planted',
    co2eImpactPerUnit: 21,
    leaderboardEnabled: false,
    pointsAllAttendees: 100,
    hostId: 'host_456',
    hostName: 'Urban Green Initiative',
    ageRestriction: '12+',
    howItWorks: '1. Sign up for the event in the app.\n2. On the event date go to the event location.\n3. Check in within 100 metres of the event location during the event time.\n4. Participate and complete the activity.\n5. Earn your points and rewards.',
    status: 'published',
    orgId: null
  }
];

async function seedEvents() {
  try {
    console.log('🌱 Seeding events to Firebase...');
    
    const batch = db.batch();
    
    for (const event of MOCK_EVENTS) {
      const eventRef = db.collection('events').doc(event.eventId);
      const now = new Date();
      
      const eventData = {
        ...event,
        createdAt: admin.firestore.Timestamp.fromDate(now),
        updatedAt: admin.firestore.Timestamp.fromDate(now),
        publishedAt: admin.firestore.Timestamp.fromDate(now),
        startDateTime: admin.firestore.Timestamp.fromDate(new Date(event.startDateTime)),
        endDateTime: admin.firestore.Timestamp.fromDate(new Date(event.endDateTime))
      };
      
      batch.set(eventRef, eventData);
      console.log(`   Adding: ${event.eventName}`);
    }
    
    await batch.commit();
    console.log('✅ Successfully seeded events to Firebase!');
    console.log(`   Total events seeded: ${MOCK_EVENTS.length}`);
    
  } catch (error) {
    console.error('❌ Error seeding events:', error);
    process.exit(1);
  }
}

seedEvents().then(() => {
  process.exit(0);
});
