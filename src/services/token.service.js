const jwt = require('jsonwebtoken');
const { TOKEN_EXPIRY, ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Generate JWT token for redemption QR code
 */
function generateRedemptionToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY.REDEMPTION
  });
}

/**
 * Verify and decode redemption token
 */
function verifyRedemptionToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.EXPIRED_TOKEN, 'Redemption token has expired');
    }
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_TOKEN, 'Invalid redemption token');
  }
}

/**
 * Generate partner API key
 */
function generatePartnerApiKey(partnerId) {
  const payload = {
    partnerId,
    type: 'partner_api_key',
    createdAt: new Date().toISOString()
  };
  
  // Generate long-lived token for partner API key
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '365d' // 1 year
  });
}

module.exports = {
  generateRedemptionToken,
  verifyRedemptionToken,
  generatePartnerApiKey
};
