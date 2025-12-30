const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for general API endpoints
 */
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Stricter rate limiter for redemption endpoints
 */
const redemptionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Max 20 redemptions per 15 minutes
  message: {
    error: 'REDEMPTION_RATE_LIMIT_EXCEEDED',
    message: 'Too many redemption attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Rate limiter for partner scanning endpoints
 */
const partnerScanLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Max 30 scans per minute
  message: {
    error: 'SCAN_RATE_LIMIT_EXCEEDED',
    message: 'Too many scan attempts. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  apiLimiter,
  redemptionLimiter,
  partnerScanLimiter
};
