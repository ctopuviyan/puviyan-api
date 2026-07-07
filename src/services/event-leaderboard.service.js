const { getFirestore, admin } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');

/**
 * Event Leaderboard Service - Handles leaderboard operations for events
 */

/**
 * Get leaderboard for an event
 * Returns users ranked by their carbon score/points
 */
async function getLeaderboard(eventId) {
  const db = getFirestore();

  // Get event details
  const eventDoc = await db.collection('events').doc(eventId).get();
  if (!eventDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.EVT_NOT_FOUND, 'Event not found');
  }

  const event = eventDoc.data();

  // Get leaderboard sub-collection
  const leaderboardSnapshot = await db
    .collection('events')
    .doc(eventId)
    .collection('leaderboard')
    .orderBy('carbonScore', 'desc')
    .get();

  const leaderboard = leaderboardSnapshot.docs.map((doc, index) => {
    const data = doc.data();
    return {
      rank: index + 1,
      userId: doc.id,
      userName: data.userName || 'Anonymous',
      carbonScore: data.carbonScore || 0,
      points: data.points || 0,
      joinedAt: data.joinedAt?.toDate?.()?.toISOString()
    };
  });

  return {
    eventId,
    eventName: event.eventName || event.data?.basics?.event_name || 'Event',
    totalParticipants: leaderboard.length,
    leaderboard
  };
}

/**
 * Get event details with leaderboard combined
 */
async function getEventWithLeaderboard(eventId) {
  const db = getFirestore();

  // Get event details
  const eventDoc = await db.collection('events').doc(eventId).get();
  if (!eventDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.EVT_NOT_FOUND, 'Event not found');
  }

  const event = eventDoc.data();

  // Get leaderboard sub-collection
  const leaderboardSnapshot = await db
    .collection('events')
    .doc(eventId)
    .collection('leaderboard')
    .orderBy('carbonScore', 'desc')
    .get();

  const leaderboard = leaderboardSnapshot.docs.map((doc, index) => {
    const data = doc.data();
    return {
      rank: index + 1,
      userId: doc.id,
      userName: data.userName || 'Anonymous',
      carbonScore: data.carbonScore || 0,
      points: data.points || 0,
      joinedAt: data.joinedAt?.toDate?.()?.toISOString()
    };
  });

  // Format event data
  const eventData = {
    eventId: eventDoc.id,
    ...event,
    startDateTime: event.startDateTime?.toDate?.()?.toISOString(),
    endDateTime: event.endDateTime?.toDate?.()?.toISOString(),
    createdAt: event.createdAt?.toDate?.()?.toISOString(),
    updatedAt: event.updatedAt?.toDate?.()?.toISOString(),
    publishedAt: event.publishedAt?.toDate?.()?.toISOString()
  };

  return {
    event: eventData,
    leaderboard: {
      totalParticipants: leaderboard.length,
      participants: leaderboard
    }
  };
}

/**
 * Add user to leaderboard (for testing/demo purposes)
 */
async function addUserToLeaderboard({ eventId, userId, userName, carbonScore, points }) {
  const db = getFirestore();

  // Get event details
  const eventDoc = await db.collection('events').doc(eventId).get();
  if (!eventDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.EVT_NOT_FOUND, 'Event not found');
  }

  // Add user to leaderboard sub-collection
  const leaderboardData = {
    userId,
    userName: userName || 'Anonymous',
    carbonScore: carbonScore || 0,
    points: points || carbonScore || 0,
    joinedAt: admin.firestore.Timestamp.fromDate(new Date())
  };

  await db
    .collection('events')
    .doc(eventId)
    .collection('leaderboard')
    .doc(userId)
    .set(leaderboardData);

  return {
    eventId,
    userId,
    userName: leaderboardData.userName,
    carbonScore: leaderboardData.carbonScore,
    points: leaderboardData.points,
    message: 'User added to leaderboard successfully'
  };
}

module.exports = {
  getLeaderboard,
  addUserToLeaderboard,
  getEventWithLeaderboard
};
