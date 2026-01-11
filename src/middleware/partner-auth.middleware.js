const { getPartnerAuth, initializePartnerFirebase } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');

/**
 * Verify Firebase ID token issued by the partner Firebase project
 */
async function verifyPartnerFirebaseToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        errorCode: ERROR_CODES.AUTH_MISSING_HEADER,
        message: 'Missing or invalid authorization header',
      });
    }

    const idToken = authHeader.split('Bearer ')[1];

    // Ensure partner auth app is initialized
    initializePartnerFirebase();

    const decodedToken = await getPartnerAuth().verifyIdToken(idToken);

    req.partnerUser = {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };

    next();
  } catch (error) {
    console.error('Partner token verification error:', error);
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      errorCode: ERROR_CODES.AUTH_INVALID_TOKEN,
      message: 'Invalid or expired token',
    });
  }
}

module.exports = {
  verifyPartnerFirebaseToken,
};
