const { getAuth } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');

/**
 * Verify Firebase ID token from Authorization header
 */
async function verifyFirebaseToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        errorCode: ERROR_CODES.AUTH_MISSING_HEADER,
        message: 'Missing or invalid authorization header'
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await getAuth().verifyIdToken(idToken);
    
    // Attach user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      phoneNumber: decodedToken.phone_number
    };
    
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      errorCode: ERROR_CODES.AUTH_INVALID_TOKEN,
      message: 'Invalid or expired token'
    });
  }
}

/**
 * Optional authentication - doesn't fail if token is missing
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1];
      const decodedToken = await getAuth().verifyIdToken(idToken);
      
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        phoneNumber: decodedToken.phone_number
      };
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
}

module.exports = {
  verifyFirebaseToken,
  optionalAuth
};
