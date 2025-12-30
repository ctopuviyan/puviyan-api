const { getFirestore } = require('../config/firebase.config');
const { COLLECTIONS, ERROR_CODES, HTTP_STATUS } = require('../config/constants');

/**
 * Verify partner API key
 */
async function verifyPartnerKey(req, res, next) {
  try {
    const apiKey = req.headers['x-partner-api-key'];
    
    if (!apiKey) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        error: ERROR_CODES.UNAUTHORIZED,
        message: 'Missing partner API key'
      });
    }

    const db = getFirestore();
    
    // Query partners collection for matching API key
    const partnersSnapshot = await db.collection(COLLECTIONS.PARTNERS)
      .where('apiKey', '==', apiKey)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (partnersSnapshot.empty) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        error: ERROR_CODES.INVALID_PARTNER,
        message: 'Invalid or inactive partner API key'
      });
    }

    const partnerDoc = partnersSnapshot.docs[0];
    req.partner = {
      id: partnerDoc.id,
      ...partnerDoc.data()
    };
    
    next();
  } catch (error) {
    console.error('Partner verification error:', error);
    return res.status(HTTP_STATUS.INTERNAL_ERROR).json({
      error: ERROR_CODES.SERVER_ERROR,
      message: 'Failed to verify partner credentials'
    });
  }
}

module.exports = {
  verifyPartnerKey
};
