const { HTTP_STATUS, ERROR_CODES, ERROR_MESSAGES } = require('../config/constants');

/**
 * Global error handler middleware
 */
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  // Default error response
  const statusCode = err.statusCode || HTTP_STATUS.INTERNAL_ERROR;
  const errorCode = err.code || ERROR_CODES.SERVER_ERROR;
  
  // Use custom message if provided, otherwise use default from ERROR_MESSAGES
  const message = err.message || ERROR_MESSAGES[errorCode] || 'An unexpected error occurred';

  res.status(statusCode).json({
    errorCode: errorCode,
    message: message,
    ...(err.details && { details: err.details }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

/**
 * Create custom error
 */
class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

module.exports = {
  errorHandler,
  ApiError
};
