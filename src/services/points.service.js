const { getFirestore, admin } = require('../config/firebase.config');
const { COLLECTIONS, POINTS, ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');

/**
 * Get user's points balance
 */
async function getPointsBalance(userId) {
  const db = getFirestore();

  // Points are stored in users/{uid}/points subcollection or as a field
  // For now, using a simple document structure
  const pointsDoc = await db.collection(COLLECTIONS.USERS).doc(userId).collection(COLLECTIONS.POINTS).doc('balance').get();

  if (!pointsDoc.exists) {
    // Initialize points if not exists
    const initialBalance = {
      balance: 0,
      earned: 0,
      redeemed: 0,
      lastUpdated: new Date()
    };
    await db.collection(COLLECTIONS.USERS).doc(userId).collection(COLLECTIONS.POINTS).doc('balance').set(initialBalance);
    return initialBalance;
  }

  return pointsDoc.data();
}

/**
 * Calculate discount based on points and partner
 */
async function calculateDiscount({ userId, points, partnerId }) {
  const db = getFirestore();

  // Validate minimum points
  if (points < POINTS.MIN_REDEMPTION) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INSUFFICIENT_POINTS, `Minimum redemption is ${POINTS.MIN_REDEMPTION} points`);
  }

  // Get partner details for custom redemption rate
  const partnerDoc = await db.collection(COLLECTIONS.PARTNERS).doc(partnerId).get();
  if (!partnerDoc.exists) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_PARTNER, 'Partner not found');
  }

  const partner = partnerDoc.data();
  const redemptionRate = partner.redemptionRate || POINTS.TO_CURRENCY_RATE;

  // Calculate discount: points / rate = currency
  // Example: 500 points / 10 = ₹50
  const discount = Math.floor(points / redemptionRate);

  // Check max discount limit
  if (discount > POINTS.MAX_REDEMPTION_AMOUNT) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, `Maximum discount is ₹${POINTS.MAX_REDEMPTION_AMOUNT}`);
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
 * Deduct points from user's balance
 */
async function deductPoints(userId, points, redemptionId) {
  const db = getFirestore();

  const pointsRef = db.collection(COLLECTIONS.USERS).doc(userId).collection(COLLECTIONS.POINTS).doc('balance');

  try {
    await db.runTransaction(async (transaction) => {
      const pointsDoc = await transaction.get(pointsRef);
      
      if (!pointsDoc.exists) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INSUFFICIENT_POINTS, 'User has no points');
      }

      const currentBalance = pointsDoc.data().balance || 0;

      if (currentBalance < points) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INSUFFICIENT_POINTS, 'Insufficient points balance');
      }

      const newBalance = currentBalance - points;
      const redeemed = (pointsDoc.data().redeemed || 0) + points;

      transaction.update(pointsRef, {
        balance: newBalance,
        redeemed,
        lastUpdated: new Date()
      });

      // Add transaction record
      const transactionRef = db.collection(COLLECTIONS.USERS).doc(userId).collection(COLLECTIONS.POINTS).doc();
      transaction.set(transactionRef, {
        type: 'redeem',
        points: -points,
        redemptionId,
        timestamp: new Date(),
        balanceAfter: newBalance
      });
    });

    return { success: true, pointsDeducted: points };
  } catch (error) {
    throw error;
  }
}

/**
 * Refund points to user's balance
 */
async function refundPoints(userId, points, redemptionId) {
  const db = getFirestore();

  const pointsRef = db.collection(COLLECTIONS.USERS).doc(userId).collection(COLLECTIONS.POINTS).doc('balance');

  try {
    await db.runTransaction(async (transaction) => {
      const pointsDoc = await transaction.get(pointsRef);
      
      if (!pointsDoc.exists) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'User points record not found');
      }

      const currentBalance = pointsDoc.data().balance || 0;
      const newBalance = currentBalance + points;
      const redeemed = Math.max((pointsDoc.data().redeemed || 0) - points, 0);

      transaction.update(pointsRef, {
        balance: newBalance,
        redeemed,
        lastUpdated: new Date()
      });

      // Add refund transaction record
      const transactionRef = db.collection(COLLECTIONS.USERS).doc(userId).collection(COLLECTIONS.POINTS).doc();
      transaction.set(transactionRef, {
        type: 'refund',
        points: points,
        redemptionId,
        timestamp: new Date(),
        balanceAfter: newBalance
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
  deductPoints,
  refundPoints,
  getAvailableOffers
};
