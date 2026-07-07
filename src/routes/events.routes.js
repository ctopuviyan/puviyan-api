const express = require('express');
const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimit.middleware');
const { cacheMiddleware } = require('../middleware/cache.middleware');
const eventsController = require('../controllers/events.controller');

/**
 * Get events (public)
 * Query params:
 * - host: filter by hostId
 * - eventId: get specific event by id
 * Cache for 5 minutes
 */
router.get('/', cacheMiddleware(300), apiLimiter, eventsController.getEvents);

/**
 * Get event details with leaderboard combined (public)
 * Cache for 1 minute
 */
router.get('/:eventId/details', cacheMiddleware(60), apiLimiter, eventsController.getEventWithLeaderboard);

/**
 * Get event leaderboard (public)
 * Cache for 1 minute
 */
router.get('/:eventId/leaderboard', cacheMiddleware(60), apiLimiter, eventsController.getLeaderboard);

/**
 * Add user to leaderboard
 */
router.post('/:eventId/leaderboard', apiLimiter, eventsController.addUserToLeaderboard);

module.exports = router;
