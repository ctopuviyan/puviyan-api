const { getFirestore, admin } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');

// Mock mode for local testing without Firebase credentials
const MOCK_MODE = process.env.MOCK_MODE === 'true' || process.env.NODE_ENV === 'development';
console.log('🔧 MOCK_MODE:', MOCK_MODE, '(MOCK_MODE env:', process.env.MOCK_MODE, ', NODE_ENV:', process.env.NODE_ENV + ')');

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

/**
 * Events Service - Handles event management operations
 * Supports: CRUD operations, status transitions, validation
 */

// Event type configurations
const EVENT_TYPE_CONFIG = {
  tree_plantation: {
    contributionUnit: 'Trees planted',
    co2eHelperText: 'Suggested: 21 kg CO₂e per tree per year. Actual value may vary by species and location.',
    defaultGuideline: 'Wear comfortable clothes and closed shoes. Carry water. Follow host instructions at all times.'
  },
  cleanup_water: {
    contributionUnit: 'kg of waste collected',
    co2eHelperText: 'Suggested: 2–6 kg CO₂e per kg of waste removed. Actual value may vary by waste type.',
    defaultGuideline: 'Do not enter the water. Wear gloves at all times. Avoid touching sharp or hazardous waste.'
  },
  cleanup_neighbourhood: {
    contributionUnit: 'kg of waste collected',
    co2eHelperText: 'Suggested: 2–4 kg CO₂e per kg of waste removed. Actual value may vary by waste type.',
    defaultGuideline: 'Wear gloves and closed shoes. Do not touch sharp objects or hazardous waste.'
  },
  collection_drive: {
    contributionUnit: 'kg collected',
    co2eHelperText: 'Suggested: 3–8 kg CO₂e per kg of e-waste or plastic diverted from landfill.',
    defaultGuideline: 'Handle e-waste with care. Do not dismantle any devices. Follow host instructions.'
  },
  awareness_workshop: {
    contributionUnit: null,
    co2eHelperText: null,
    defaultGuideline: 'Arrive on time. Carry a notebook or device for notes. Engage respectfully with all participants.'
  }
};

/**
 * Auto-populate contribution unit based on event type
 */
function getContributionUnit(eventType) {
  return EVENT_TYPE_CONFIG[eventType]?.contributionUnit || null;
}

/**
 * Auto-populate CO2e helper text based on event type
 */
function getCo2eHelperText(eventType) {
  return EVENT_TYPE_CONFIG[eventType]?.co2eHelperText || null;
}

/**
 * Auto-populate default guidelines based on event type
 */
function getDefaultGuideline(eventType) {
  return EVENT_TYPE_CONFIG[eventType]?.defaultGuideline || null;
}

/**
 * Auto-generate "How it works" based on event mode
 */
function generateHowItWorks(eventMode) {
  if (eventMode === 'onsite') {
    return `1. Sign up for the event in the app.
2. On the event date go to the event location.
3. Check in within 100 metres of the event location during the event time.
4. Participate and complete the activity.
5. Earn your points and rewards.`;
  } else {
    return `1. Sign up for the event in the app.
2. On the event date join using the event link provided.
3. Participate in the session.
4. Earn your points and rewards.`;
  }
}

/**
 * Validate event data
 */
function validateEventData(data, isPublish = false) {
  const errors = [];

  // Basic validation
  if (!data.eventName || data.eventName.trim().length === 0) {
    errors.push('Event name is required');
  }
  if (data.eventName && data.eventName.length > 100) {
    errors.push('Event name must be 100 characters or less');
  }

  if (!data.eventMode || !['onsite', 'online'].includes(data.eventMode)) {
    errors.push('Event mode must be either onsite or online');
  }

  if (!data.eventType || !Object.keys(EVENT_TYPE_CONFIG).includes(data.eventType)) {
    errors.push('Invalid event type');
  }

  if (!data.eventVisibility || !['public', 'private'].includes(data.eventVisibility)) {
    errors.push('Event visibility must be either public or private');
  }

  if (!data.startDateTime) {
    errors.push('Start date and time is required');
  }

  if (!data.endDateTime) {
    errors.push('End date and time is required');
  }

  if (data.startDateTime && data.endDateTime && new Date(data.endDateTime) <= new Date(data.startDateTime)) {
    errors.push('End time must be after start time');
  }

  if (data.startDateTime && new Date(data.startDateTime) < new Date()) {
    errors.push('Start date must be today or in the future');
  }

  // Mode-specific validation
  if (data.eventMode === 'onsite' && !data.location) {
    errors.push('Location is required for onsite events');
  }

  if (data.eventMode === 'online' && !data.virtualLink) {
    errors.push('Virtual link is required for online events');
  }

  if (data.eventMode === 'online' && data.virtualLink && !isValidUrl(data.virtualLink)) {
    errors.push('Virtual link must be a valid URL');
  }

  // About event validation
  if (!data.aboutEvent || data.aboutEvent.trim().length < 50) {
    errors.push('About event must be at least 50 characters');
  }
  if (data.aboutEvent && data.aboutEvent.length > 1000) {
    errors.push('About event must be 1000 characters or less');
  }

  // Spots validation
  if (data.spotsAvailable !== null && data.spotsAvailable !== undefined && data.spotsAvailable < 1) {
    errors.push('Spots available must be at least 1 if specified');
  }

  // Points configuration validation
  if (data.leaderboardEnabled) {
    if (!data.pointsFirstPlace || data.pointsFirstPlace < 1 || data.pointsFirstPlace > 1000) {
      errors.push('Points for 1st place must be between 1 and 1000');
    }
    if (!data.pointsSecondPlace || data.pointsSecondPlace < 1 || data.pointsSecondPlace > 1000) {
      errors.push('Points for 2nd place must be between 1 and 1000');
    }
    if (!data.pointsThirdPlace || data.pointsThirdPlace < 1 || data.pointsThirdPlace > 1000) {
      errors.push('Points for 3rd place must be between 1 and 1000');
    }
    if (!data.pointsOthers || data.pointsOthers < 1 || data.pointsOthers > 1000) {
      errors.push('Points for others must be between 1 and 1000');
    }
    // Validate hierarchy
    if (data.pointsSecondPlace > data.pointsFirstPlace) {
      errors.push('Points for 2nd place must be less than or equal to 1st place');
    }
    if (data.pointsThirdPlace > data.pointsSecondPlace) {
      errors.push('Points for 3rd place must be less than or equal to 2nd place');
    }
    if (data.pointsOthers > data.pointsThirdPlace) {
      errors.push('Points for others must be less than or equal to 3rd place');
    }
  } else {
    if (!data.pointsAllAttendees || data.pointsAllAttendees < 1 || data.pointsAllAttendees > 1000) {
      errors.push('Points for all attendees must be between 1 and 1000');
    }
  }

  // CO2e validation (only for non-awareness events)
  if (data.eventType !== 'awareness_workshop') {
    if (!data.co2eImpactPerUnit || data.co2eImpactPerUnit < 0.1 || data.co2eImpactPerUnit > 100) {
      errors.push('CO2e impact per unit must be between 0.1 and 100');
    }
  }

  // Publish-specific validation
  if (isPublish) {
    if (!data.bannerUrl) {
      errors.push('Banner image is required to publish');
    }
    if (!data.termsAccepted) {
      errors.push('Terms and conditions must be accepted to publish');
    }
  }

  return errors;
}

/**
 * Validate URL format
 */
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Create event (as draft or published)
 */
async function createEvent({ eventData, hostId, hostName, orgId }) {
  const db = getFirestore();
  const isPublish = eventData.status === 'published';

  // Validate event data
  const validationErrors = validateEventData(eventData, isPublish);
  if (validationErrors.length > 0) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VAL_VALIDATION_ERROR,
      validationErrors.join('; ')
    );
  }

  // Auto-populate fields
  const contributionUnit = getContributionUnit(eventData.eventType);
  const co2eHelperText = getCo2eHelperText(eventData.eventType);
  const defaultGuideline = getDefaultGuideline(eventData.eventType);
  const howItWorks = generateHowItWorks(eventData.eventMode);

  const eventDocRef = db.collection('events').doc();
  const now = new Date();

  const event = {
    eventId: eventDocRef.id,
    eventName: eventData.eventName,
    bannerUrl: eventData.bannerUrl || null,
    eventMode: eventData.eventMode,
    eventType: eventData.eventType,
    eventVisibility: eventData.eventVisibility || 'private',
    startDateTime: admin.firestore.Timestamp.fromDate(new Date(eventData.startDateTime)),
    endDateTime: admin.firestore.Timestamp.fromDate(new Date(eventData.endDateTime)),
    timeZone: eventData.timeZone || 'Asia/Kolkata',
    location: eventData.location || null,
    virtualLink: eventData.virtualLink || null,
    aboutEvent: eventData.aboutEvent,
    spotsAvailable: eventData.spotsAvailable || null,
    contributionUnit,
    co2eImpactPerUnit: eventData.eventType !== 'awareness_workshop' ? eventData.co2eImpactPerUnit : null,
    leaderboardEnabled: eventData.leaderboardEnabled !== undefined ? eventData.leaderboardEnabled : true,
    pointsAllAttendees: eventData.leaderboardEnabled ? null : eventData.pointsAllAttendees,
    pointsFirstPlace: eventData.leaderboardEnabled ? eventData.pointsFirstPlace : null,
    pointsSecondPlace: eventData.leaderboardEnabled ? eventData.pointsSecondPlace : null,
    pointsThirdPlace: eventData.leaderboardEnabled ? eventData.pointsThirdPlace : null,
    pointsOthers: eventData.leaderboardEnabled ? eventData.pointsOthers : null,
    hostId,
    hostName,
    hostMessage: eventData.hostMessage || null,
    ageRestriction: eventData.ageRestriction || '18+',
    additionalGuidelines: eventData.additionalGuidelines || null,
    howItWorks,
    orgId: orgId || null,
    status: isPublish ? 'published' : 'draft',
    createdAt: admin.firestore.Timestamp.fromDate(now),
    updatedAt: admin.firestore.Timestamp.fromDate(now),
    publishedAt: isPublish ? admin.firestore.Timestamp.fromDate(now) : null,
    liveAt: null,
    completedAt: null,
    cancelledAt: null,
    repeatEvent: eventData.repeatEvent || 'none',
    termsAccepted: eventData.termsAccepted || false
  };

  await eventDocRef.set(event);

  return {
    eventId: event.eventId,
    status: event.status,
    message: isPublish 
      ? 'Event published successfully' 
      : 'Event saved as draft'
  };
}

/**
 * Update event
 */
async function updateEvent({ eventId, eventData, hostId }) {
  const db = getFirestore();

  const eventDoc = await db.collection('events').doc(eventId).get();
  if (!eventDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.EVT_NOT_FOUND, 'Event not found');
  }

  const existingEvent = eventDoc.data();

  // Check if user is the host or admin
  if (existingEvent.hostId !== hostId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'Only event host can update this event');
  }

  // Validate event data
  const isPublish = eventData.status === 'published' && existingEvent.status !== 'published';
  const validationErrors = validateEventData(eventData, isPublish);
  if (validationErrors.length > 0) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VAL_VALIDATION_ERROR,
      validationErrors.join('; ')
    );
  }

  // Build update object
  const updateData = {
    updatedAt: admin.firestore.Timestamp.fromDate(new Date())
  };

  // Update fields that are provided
  if (eventData.eventName !== undefined) updateData.eventName = eventData.eventName;
  if (eventData.bannerUrl !== undefined) updateData.bannerUrl = eventData.bannerUrl;
  if (eventData.eventMode !== undefined) updateData.eventMode = eventData.eventMode;
  if (eventData.eventType !== undefined) updateData.eventType = eventData.eventType;
  if (eventData.eventVisibility !== undefined) updateData.eventVisibility = eventData.eventVisibility;
  if (eventData.startDateTime !== undefined) updateData.startDateTime = admin.firestore.Timestamp.fromDate(new Date(eventData.startDateTime));
  if (eventData.endDateTime !== undefined) updateData.endDateTime = admin.firestore.Timestamp.fromDate(new Date(eventData.endDateTime));
  if (eventData.location !== undefined) updateData.location = eventData.location;
  if (eventData.virtualLink !== undefined) updateData.virtualLink = eventData.virtualLink;
  if (eventData.aboutEvent !== undefined) updateData.aboutEvent = eventData.aboutEvent;
  if (eventData.spotsAvailable !== undefined) updateData.spotsAvailable = eventData.spotsAvailable;
  if (eventData.leaderboardEnabled !== undefined) {
    updateData.leaderboardEnabled = eventData.leaderboardEnabled;
    updateData.contributionUnit = getContributionUnit(eventData.eventType || existingEvent.eventType);
  }
  if (eventData.co2eImpactPerUnit !== undefined) updateData.co2eImpactPerUnit = eventData.co2eImpactPerUnit;
  if (eventData.pointsAllAttendees !== undefined) updateData.pointsAllAttendees = eventData.pointsAllAttendees;
  if (eventData.pointsFirstPlace !== undefined) updateData.pointsFirstPlace = eventData.pointsFirstPlace;
  if (eventData.pointsSecondPlace !== undefined) updateData.pointsSecondPlace = eventData.pointsSecondPlace;
  if (eventData.pointsThirdPlace !== undefined) updateData.pointsThirdPlace = eventData.pointsThirdPlace;
  if (eventData.pointsOthers !== undefined) updateData.pointsOthers = eventData.pointsOthers;
  if (eventData.hostMessage !== undefined) updateData.hostMessage = eventData.hostMessage;
  if (eventData.ageRestriction !== undefined) updateData.ageRestriction = eventData.ageRestriction;
  if (eventData.additionalGuidelines !== undefined) updateData.additionalGuidelines = eventData.additionalGuidelines;
  if (eventData.eventMode !== undefined) updateData.howItWorks = generateHowItWorks(eventData.eventMode);
  if (eventData.eventType !== undefined) {
    updateData.contributionUnit = getContributionUnit(eventData.eventType);
  }

  // Handle status change
  if (eventData.status && eventData.status !== existingEvent.status) {
    if (!validateStatusTransition(existingEvent.status, eventData.status)) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.EVT_INVALID_STATUS_TRANSITION,
        `Cannot transition from ${existingEvent.status} to ${eventData.status}`
      );
    }
    updateData.status = eventData.status;
    if (eventData.status === 'published' && !existingEvent.publishedAt) {
      updateData.publishedAt = admin.firestore.Timestamp.fromDate(new Date());
    }
  }

  await db.collection('events').doc(eventId).update(updateData);

  return {
    eventId,
    status: updateData.status || existingEvent.status,
    message: 'Event updated successfully'
  };
}

/**
 * Validate status transition
 */
function validateStatusTransition(currentStatus, newStatus) {
  const validTransitions = {
    draft: ['published', 'draft'],
    published: ['live', 'cancelled'],
    live: ['cancelled', 'completed'],
    completed: [],
    cancelled: []
  };

  return validTransitions[currentStatus]?.includes(newStatus);
}

/**
 * Delete event (draft only)
 */
async function deleteEvent({ eventId, hostId }) {
  const db = getFirestore();

  const eventDoc = await db.collection('events').doc(eventId).get();
  if (!eventDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.EVT_NOT_FOUND, 'Event not found');
  }

  const event = eventDoc.data();

  if (event.hostId !== hostId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'Only event host can delete this event');
  }

  if (event.status !== 'draft') {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.EVT_INVALID_STATUS,
      'Only draft events can be deleted. Use cancel for published/live events.'
    );
  }

  await db.collection('events').doc(eventId).delete();

  return {
    eventId,
    message: 'Event deleted successfully'
  };
}

/**
 * Publish event
 */
async function publishEvent({ eventId, hostId }) {
  const db = getFirestore();

  const eventDoc = await db.collection('events').doc(eventId).get();
  if (!eventDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.EVT_NOT_FOUND, 'Event not found');
  }

  const event = eventDoc.data();

  if (event.hostId !== hostId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'Only event host can publish this event');
  }

  if (event.status !== 'draft') {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.EVT_INVALID_STATUS,
      'Only draft events can be published'
    );
  }

  if (!event.bannerUrl) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VAL_VALIDATION_ERROR,
      'Banner image is required to publish event'
    );
  }

  const now = new Date();
  await db.collection('events').doc(eventId).update({
    status: 'published',
    publishedAt: admin.firestore.Timestamp.fromDate(now),
    updatedAt: admin.firestore.Timestamp.fromDate(now)
  });

  return {
    eventId,
    status: 'published',
    message: 'Event published successfully'
  };
}

/**
 * Cancel event
 */
async function cancelEvent({ eventId, hostId }) {
  const db = getFirestore();

  const eventDoc = await db.collection('events').doc(eventId).get();
  if (!eventDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.EVT_NOT_FOUND, 'Event not found');
  }

  const event = eventDoc.data();

  if (event.hostId !== hostId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'Only event host can cancel this event');
  }

  if (!['published', 'live'].includes(event.status)) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.EVT_INVALID_STATUS,
      'Only published or live events can be cancelled'
    );
  }

  const now = new Date();
  await db.collection('events').doc(eventId).update({
    status: 'cancelled',
    cancelledAt: admin.firestore.Timestamp.fromDate(now),
    updatedAt: admin.firestore.Timestamp.fromDate(now)
  });

  return {
    eventId,
    status: 'cancelled',
    message: 'Event cancelled successfully'
  };
}

/**
 * Complete event
 */
async function completeEvent({ eventId, hostId }) {
  const db = getFirestore();

  const eventDoc = await db.collection('events').doc(eventId).get();
  if (!eventDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.EVT_NOT_FOUND, 'Event not found');
  }

  const event = eventDoc.data();

  if (event.hostId !== hostId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'Only event host can complete this event');
  }

  if (event.status !== 'live') {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.EVT_INVALID_STATUS,
      'Only live events can be completed'
    );
  }

  // Check if event has ended
  const now = new Date();
  if (event.endDateTime.toDate() > now) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.EVT_INVALID_STATUS,
      'Event cannot be completed before its end time'
    );
  }

  await db.collection('events').doc(eventId).update({
    status: 'completed',
    completedAt: admin.firestore.Timestamp.fromDate(now),
    updatedAt: admin.firestore.Timestamp.fromDate(now)
  });

  // Mock mode for local testing
  if (MOCK_MODE) {
    const event = MOCK_EVENTS.find(e => e.eventId === eventId);
    if (!event) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.EVT_NOT_FOUND, 'Event not found');
    }
    return event;
  }

  return {
    eventId,
    status: 'completed',
    message: 'Event completed successfully'
  };
}

/**
 * Get all events (admin/management view)
 */
async function getAllEvents({ orgId, status, limit = 20, offset = 0 }) {
  const db = getFirestore();

  let query = db.collection('events');

  if (orgId) {
    query = query.where('orgId', '==', orgId);
  }

  if (status) {
    query = query.where('status', '==', status);
  }

  query = query.orderBy('createdAt', 'desc')
    .limit(limit)
    .offset(offset);

  const snapshot = await query.get();

  const events = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      eventId: doc.id,
      ...data,
      startDateTime: data.startDateTime?.toDate?.()?.toISOString(),
      endDateTime: data.endDateTime?.toDate?.()?.toISOString(),
      createdAt: data.createdAt?.toDate?.()?.toISOString(),
      updatedAt: data.updatedAt?.toDate?.()?.toISOString(),
      publishedAt: data.publishedAt?.toDate?.()?.toISOString(),
      liveAt: data.liveAt?.toDate?.()?.toISOString(),
      completedAt: data.completedAt?.toDate?.()?.toISOString(),
      cancelledAt: data.cancelledAt?.toDate?.()?.toISOString()
    };
  });

  return {
    events,
    total: events.length,
    limit,
    offset
  };
}

/**
 * Get event details
 */
async function getEventDetails(eventId) {
  const db = getFirestore();

  const eventDoc = await db.collection('events').doc(eventId).get();

  if (!eventDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.EVT_NOT_FOUND, 'Event not found');
  }

  const data = eventDoc.data();

  return {
    eventId: eventDoc.id,
    ...data,
    startDateTime: data.startDateTime?.toDate?.()?.toISOString(),
    endDateTime: data.endDateTime?.toDate?.()?.toISOString(),
    createdAt: data.createdAt?.toDate?.()?.toISOString(),
    updatedAt: data.updatedAt?.toDate?.()?.toISOString(),
    publishedAt: data.publishedAt?.toDate?.()?.toISOString(),
    liveAt: data.liveAt?.toDate?.()?.toISOString(),
    completedAt: data.completedAt?.toDate?.()?.toISOString(),
    cancelledAt: data.cancelledAt?.toDate?.()?.toISOString()
  };
}

/**
 * Get published events for users (public view)
 * - No hostId: returns all public events only
 * - With hostId: returns that host's events (public + private) + all other hosts' public events
 */
async function getPublishedEvents({ userId, orgId, hostId, eventType, limit = 20, offset = 0 }) {
  const db = getFirestore();

  // Get user's orgId if userId provided
  let userOrgId = null;
  if (userId) {
    const userDoc = await db.collection('informations').doc(userId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      userOrgId = userData.orgMembership?.orgId || null;
    }
  }

  let query = db.collection('events')
    .where('status', '==', 'published')
    .limit(100);

  const snapshot = await query.get();

  // Filter by startDateTime in memory to avoid composite index
  const now = new Date();
  const events = snapshot.docs
    .map(doc => {
      const data = doc.data();
      return {
        eventId: doc.id,
        ...data,
        startDateTime: data.startDateTime?.toDate?.()?.toISOString(),
        endDateTime: data.endDateTime?.toDate?.()?.toISOString(),
        createdAt: data.createdAt?.toDate?.()?.toISOString()
      };
    })
    .filter(event => {
      // Filter by startDateTime (future events only)
      if (event.startDateTime && new Date(event.startDateTime) <= now) {
        return false;
      }
      
      // Visibility filtering logic:
      // - If no hostId: return only public events
      // - If hostId provided: return that host's events (public + private) + all other hosts' public events
      if (!hostId) {
        // No hostId: only return public events
        return event.eventVisibility === 'public';
      } else {
        // With hostId: return that host's events (public + private) OR other hosts' public events
        const isRequestedHost = event.hostId === hostId;
        const isPublic = event.eventVisibility === 'public';
        return isRequestedHost || isPublic;
      }
    })
    .sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime));

  // Apply pagination after filtering
  const paginatedEvents = events.slice(offset, offset + limit);

  return {
    events: paginatedEvents,
    total: events.length,
    limit,
    offset
  };
}

/**
 * Get events by hostId
 */
async function getEventsByHost({ hostId, limit = 20, offset = 0 }) {
  const db = getFirestore();

  let query = db.collection('events')
    .where('hostId', '==', hostId)
    .limit(100);

  const snapshot = await query.get();

  const events = snapshot.docs
    .map(doc => {
      const data = doc.data();
      return {
        eventId: doc.id,
        ...data,
        startDateTime: data.startDateTime?.toDate?.()?.toISOString(),
        endDateTime: data.endDateTime?.toDate?.()?.toISOString(),
        createdAt: data.createdAt?.toDate?.()?.toISOString()
      };
    })
    .sort((a, b) => new Date(b.startDateTime) - new Date(a.startDateTime));

  // Apply pagination after sorting
  const paginatedEvents = events.slice(offset, offset + limit);

  return {
    events: paginatedEvents,
    total: events.length,
    limit,
    offset
  };
}

module.exports = {
  createEvent,
  updateEvent,
  deleteEvent,
  publishEvent,
  cancelEvent,
  completeEvent,
  getAllEvents,
  getEventDetails,
  getPublishedEvents
};
