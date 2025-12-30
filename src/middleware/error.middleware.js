const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

/**
 * Global error handler middleware
 */
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  // Default error response
  const statusCode = err.statusCode || HTTP_STATUS.INTERNAL_ERROR;
  const errorCode = err.code || ERROR_CODES.SERVER_ERROR;
  const message = err.message || 'An unexpected error occurred';

  res.status(statusCode).json({
    error: errorCode,
    message: message,
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
