const eventsService = require('../services/events.service');
const eventLeaderboardService = require('../services/event-leaderboard.service');
const { HTTP_STATUS } = require('../config/constants');

/**
 * Get events (public)
 * Query params:
 * - host: filter by hostId
 * - eventId: get specific event by id
 * - userId: user's id (for org-based filtering)
 * - eventType: filter by event type
 * - limit: pagination limit
 * - offset: pagination offset
 */
async function getEvents(req, res, next) {
  try {
    const { host, eventId, userId, orgId, eventType, limit, offset } = req.query;

    // If eventId is provided, get specific event
    if (eventId) {
      const result = await eventsService.getEventDetails(eventId);
      return res.status(HTTP_STATUS.OK).json(result);
    }

    const result = await eventsService.getPublishedEvents({
      hostId: host,
      userId,
      orgId,
      eventType,
      limit: parseInt(limit) || 20,
      offset: parseInt(offset) || 0
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get event leaderboard
 */
async function getLeaderboard(req, res, next) {
  try {
    const { eventId } = req.params;

    if (!eventId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: 'VALIDATION_ERROR',
        message: 'eventId is required'
      });
    }

    const result = await eventLeaderboardService.getLeaderboard(eventId);

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Add user to leaderboard
 */
async function addUserToLeaderboard(req, res, next) {
  try {
    const { eventId } = req.params;
    const { userId, userName, carbonScore, points } = req.body;

    if (!eventId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: 'VALIDATION_ERROR',
        message: 'eventId is required'
      });
    }

    if (!userId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: 'VALIDATION_ERROR',
        message: 'userId is required'
      });
    }

    const result = await eventLeaderboardService.addUserToLeaderboard({
      eventId,
      userId,
      userName,
      carbonScore,
      points
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Get event details with leaderboard combined
 */
async function getEventWithLeaderboard(req, res, next) {
  try {
    const { eventId } = req.params;

    if (!eventId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: 'VALIDATION_ERROR',
        message: 'eventId is required'
      });
    }

    const result = await eventLeaderboardService.getEventWithLeaderboard(eventId);

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getEvents,
  getLeaderboard,
  addUserToLeaderboard,
  getEventWithLeaderboard
};
