const { getFirestore, admin } = require('../config/firebase.config');
const { COLLECTIONS, POINTS, ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');

/**
 * Get user's points balance
 */
async function getPointsBalance(userId) {
  const db = getFirestore();

  // Points are stored in informations collection with puviyanPoints field
  const userDoc = await db.collection('informations').doc(userId).get();

  if (!userDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.USR_NOT_FOUND, 'User not found');
  }

  const userData = userDoc.data();
  return {
    balance: userData.puviyanPoints || 0,
    reserved: userData.reservedPoints || 0,
    redeemed: userData.redeemedPoints || 0,
    lastUpdated: userData.lastUpdated || new Date()
  };
}

/**
 * Calculate discount based on points and partner
 */
async function calculateDiscount({ userId, points, partnerId }) {
  const db = getFirestore();

  // Validate minimum points
  if (points < POINTS.MIN_REDEMPTION) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.PTS_INVALID_AMOUNT, `Minimum redemption is ${POINTS.MIN_REDEMPTION} points`);
  }

  // Get partner details for custom redemption rate
  const partnerDoc = await db.collection(COLLECTIONS.PARTNERS).doc(partnerId).get();
  if (!partnerDoc.exists) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.PTR_NOT_FOUND, 'Partner not found');
  }

  const partner = partnerDoc.data();
  const redemptionRate = partner.redemptionRate || POINTS.TO_CURRENCY_RATE;

  // Calculate discount: points / rate = currency
  // Example: 500 points / 10 = ₹50
  const discount = Math.floor(points / redemptionRate);

  // Check max discount limit
  if (discount > POINTS.MAX_REDEMPTION_AMOUNT) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.PTS_INVALID_AMOUNT, `Maximum discount is ₹${POINTS.MAX_REDEMPTION_AMOUNT}`);
  }

  return {
    points,
    discount,
    rate: redemptionRate,
    partner: {
      id: partnerId,
      name: partner.name
    }
  };
}

/**
 * Reserve points (lock but don't deduct)
 */
async function reservePoints(userId, points, redemptionId) {
  const db = getFirestore();

  const userRef = db.collection('informations').doc(userId);

  try {
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.USR_NOT_FOUND, 'User not found');
      }

      const userData = userDoc.data();
      const currentBalance = userData.puviyanPoints || 0;
      const reserved = userData.reservedPoints || 0;

      if (currentBalance < points) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.PTS_INSUFFICIENT_BALANCE, `Insufficient points balance. Available: ${currentBalance}, Required: ${points}`);
      }

      // Lock points (increase reserved, don't change puviyanPoints yet)
      transaction.update(userRef, {
        reservedPoints: reserved + points,
        lastUpdated: new Date()
      });
    });
  } catch (error) {
    throw error;
  }
}

/**
 * Deduct points from user's balance (called on redemption confirmation)
 */
async function deductPoints(userId, points, redemptionId) {
  const db = getFirestore();

  const userRef = db.collection('informations').doc(userId);

  try {
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.USR_NOT_FOUND, 'User not found');
      }

      const userData = userDoc.data();
      const currentBalance = userData.puviyanPoints || 0;
      const reserved = userData.reservedPoints || 0;
      const redeemed = userData.redeemedPoints || 0;

      // Deduct from puviyanPoints and reserved, add to redeemed
      transaction.update(userRef, {
        puviyanPoints: currentBalance - points,
        reservedPoints: Math.max(0, reserved - points),
        redeemedPoints: redeemed + points,
        lastUpdated: new Date()
      });
    });

    return { success: true, pointsDeducted: points };
  } catch (error) {
    throw error;
  }
}

/**
 * Release reserved points (called on cancellation)
 */
async function releasePoints(userId, points, redemptionId) {
  const db = getFirestore();

  const userRef = db.collection('informations').doc(userId);

  try {
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        // If user doesn't exist, nothing to release
        return;
      }

      const userData = userDoc.data();
      const reserved = userData.reservedPoints || 0;

      // Release reserved points (decrease reserved)
      transaction.update(userRef, {
        reservedPoints: Math.max(0, reserved - points),
        lastUpdated: new Date()
      });
    });
  } catch (error) {
    throw error;
  }
}

/**
 * Refund points to user's balance (for already redeemed points)
 */
async function refundPoints(userId, points, redemptionId) {
  const db = getFirestore();

  const userRef = db.collection('informations').doc(userId);

  try {
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'User points record not found');
      }

      const userData = userDoc.data();
      const currentBalance = userData.puviyanPoints || 0;
      const redeemed = userData.redeemedPoints || 0;

      // Refund points to puviyanPoints and reduce redeemed
      transaction.update(userRef, {
        puviyanPoints: currentBalance + points,
        redeemedPoints: Math.max(0, redeemed - points),
        lastUpdated: new Date()
      });
    });

    return { success: true, pointsRefunded: points };
  } catch (error) {
    throw error;
  }
}

/**
 * Get available offers
 */
async function getAvailableOffers({ partnerId, category }) {
  const db = getFirestore();

  let query = db.collection(COLLECTIONS.OFFERS)
    .where('isActive', '==', true)
    .where('validUntil', '>', new Date());

  if (partnerId) {
    query = query.where('partnerId', '==', partnerId);
  }

  if (category) {
    query = query.where('category', '==', category);
  }

  const snapshot = await query.get();

  const offers = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    validFrom: doc.data().validFrom?.toDate?.()?.toISOString(),
    validUntil: doc.data().validUntil?.toDate?.()?.toISOString()
  }));

  return { offers };
}

module.exports = {
  getPointsBalance,
  calculateDiscount,
  reservePoints,
  deductPoints,
  releasePoints,
  refundPoints,
  getAvailableOffers
};
