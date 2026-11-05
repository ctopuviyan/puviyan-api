const { getAuth, getPartnerAuth, getFirestore } = require('../config/firebase.config');
const { requirePasswordIdentity } = require('../services/sustainability-accounts.service');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');

/**
 * Verify Firebase ID token from Authorization header
 * Uses Partner Firebase Auth for partner portal tokens
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
    
    // Try Partner Auth first (for partner portal users)
    let decodedToken, partnerIdentity = false;
    try {
      decodedToken = await getPartnerAuth().verifyIdToken(idToken, true);
      partnerIdentity = true;
    } catch (partnerError) {
      // Fallback to main auth (for other users)
      decodedToken = await getAuth().verifyIdToken(idToken);
    }
    
    if (partnerIdentity) {
      const member = await getFirestore().collection('partnerUsers').doc(decodedToken.uid).get();
      if (member.data()?.membershipVersion === 2) {
        if (member.data().status !== 'active') return res.status(403).json({message:'Your sustainability membership is inactive.'});
        await requirePasswordIdentity(getPartnerAuth(), {uid:decodedToken.uid,email:decodedToken.email,signInProvider:decodedToken.firebase?.sign_in_provider});
        if (!req.baseUrl?.endsWith('/upload') || !['/image','/images'].includes(req.path)) {
          return res.status(403).json({message:'Use the sustainability v2 APIs for this account.'});
        }
      }
    }
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
 * Verify a Firebase ID token issued by the consumer app project only.
 *
 * User activity and reward progress live in the consumer Firestore project,
 * so partner-portal identities must not be allowed to address these resources
 * merely because they happen to have the same UID.
 */
async function verifyConsumerFirebaseToken(req, res, next) {
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
    req.user = { uid: decodedToken.uid };

    next();
  } catch (error) {
    console.error('Consumer token verification error:', error);
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      errorCode: ERROR_CODES.AUTH_INVALID_TOKEN,
      message: 'Invalid or expired consumer token'
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
      
      // Try Partner Auth first (for partner portal users)
      let decodedToken;
      try {
        decodedToken = await getPartnerAuth().verifyIdToken(idToken, true);
      } catch (partnerError) {
        // Fallback to main auth (for other users)
        decodedToken = await getAuth().verifyIdToken(idToken);
      }
      
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
  verifyConsumerFirebaseToken,
  optionalAuth
};
