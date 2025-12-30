/**
 * Application constants
 */

module.exports = {
  // Firestore collections
  COLLECTIONS: {
    USERS: 'users',
    PARTNERS: 'partners',
    REDEMPTIONS: 'redemptions',
    OFFERS: 'offers',
    POINTS: 'points'
  },

  // Redemption statuses
  REDEMPTION_STATUS: {
    INITIATED: 'initiated',
    RESERVED: 'reserved',
    CONFIRMED: 'confirmed',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired',
    FAILED: 'failed'
  },

  // Redemption methods
  REDEMPTION_METHOD: {
    QR: 'qr',
    API: 'api',
    WIDGET: 'widget'
  },

  // Points configuration
  POINTS: {
    MIN_REDEMPTION: parseInt(process.env.MIN_REDEMPTION_POINTS) || 100,
    TO_CURRENCY_RATE: parseInt(process.env.POINTS_TO_CURRENCY_RATE) || 10, // 10 points = ₹1
    MAX_REDEMPTION_AMOUNT: parseInt(process.env.MAX_REDEMPTION_AMOUNT) || 5000
  },

  // Token expiry (in seconds)
  TOKEN_EXPIRY: {
    REDEMPTION: parseInt(process.env.REDEMPTION_TOKEN_EXPIRY) || 300, // 5 minutes
    JWT: process.env.JWT_EXPIRY || '15m'
  },

  // Error codes
  ERROR_CODES: {
    INVALID_TOKEN: 'INVALID_TOKEN',
    EXPIRED_TOKEN: 'EXPIRED_TOKEN',
    INSUFFICIENT_POINTS: 'INSUFFICIENT_POINTS',
    INVALID_PARTNER: 'INVALID_PARTNER',
    REDEMPTION_NOT_FOUND: 'REDEMPTION_NOT_FOUND',
    ALREADY_REDEEMED: 'ALREADY_REDEEMED',
    UNAUTHORIZED: 'UNAUTHORIZED',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    SERVER_ERROR: 'SERVER_ERROR'
  },

  // HTTP status codes
  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INTERNAL_ERROR: 500
  }
};
