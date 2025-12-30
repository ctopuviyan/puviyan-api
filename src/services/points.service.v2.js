const { getFirestore, admin } = require('../config/firebase.config');
const { COLLECTIONS, POINTS, ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');

/**
 * UPDATED VERSION: Uses informationsPrivate collection
 * This matches your existing Puviyan app structure
 */

/**
 * Get user's points balance from informationsPrivate
 */
async function getPointsBalance(userId) {
  const db = getFirestore();

  // Read from informationsPrivate/{uid}
  const userDoc = await db.collection('informationsPrivate').doc(userId).get();

  if (!userDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.VALIDATION_ERROR, 'User not found');
  }

  const userData = userDoc.data();

  // Return points data (initialize if not exists)
  return {
    balance: userData.points || 0,
    earned: userData.pointsEarned || 0,
    redeemed: userData.pointsRedeemed || 0,
    lastUpdated: userData.pointsLastUpdated || new Date()
  };
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
 * Deduct points from user's balance (informationsPrivate)
 */
async function deductPoints(userId, points, redemptionId) {
  const db = getFirestore();

  const userRef = db.collection('informationsPrivate').doc(userId);

  try {
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INSUFFICIENT_POINTS, 'User not found');
      }

      const userData = userDoc.data();
      const currentBalance = userData.points || 0;

      if (currentBalance < points) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INSUFFICIENT_POINTS, 'Insufficient points balance');
      }

      const newBalance = currentBalance - points;
      const totalRedeemed = (userData.pointsRedeemed || 0) + points;

      // Update informationsPrivate with new points
      transaction.update(userRef, {
        points: newBalance,
        pointsRedeemed: totalRedeemed,
        pointsLastUpdated: new Date()
      });

      // Optional: Add transaction record in subcollection for history
      const transactionRef = db.collection('informationsPrivate').doc(userId).collection('pointsTransactions').doc();
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
 * Refund points to user's balance (informationsPrivate)
 */
async function refundPoints(userId, points, redemptionId) {
  const db = getFirestore();

  const userRef = db.collection('informationsPrivate').doc(userId);

  try {
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'User not found');
      }

      const userData = userDoc.data();
      const currentBalance = userData.points || 0;
      const newBalance = currentBalance + points;
      const totalRedeemed = Math.max((userData.pointsRedeemed || 0) - points, 0);

      // Update informationsPrivate with refunded points
      transaction.update(userRef, {
        points: newBalance,
        pointsRedeemed: totalRedeemed,
        pointsLastUpdated: new Date()
      });

      // Add refund transaction record
      const transactionRef = db.collection('informationsPrivate').doc(userId).collection('pointsTransactions').doc();
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
 * Add points to user's balance (for earning points)
 */
async function addPoints(userId, points, source, metadata = {}) {
  const db = getFirestore();

  const userRef = db.collection('informationsPrivate').doc(userId);

  try {
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'User not found');
      }

      const userData = userDoc.data();
      const currentBalance = userData.points || 0;
      const newBalance = currentBalance + points;
      const totalEarned = (userData.pointsEarned || 0) + points;

      // Update informationsPrivate with new points
      transaction.update(userRef, {
        points: newBalance,
        pointsEarned: totalEarned,
        pointsLastUpdated: new Date()
      });

      // Add transaction record
      const transactionRef = db.collection('informationsPrivate').doc(userId).collection('pointsTransactions').doc();
      transaction.set(transactionRef, {
        type: 'earn',
        points: points,
        source,
        metadata,
        timestamp: new Date(),
        balanceAfter: newBalance
      });
    });

    return { success: true, pointsAdded: points };
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
  addPoints,
  getAvailableOffers
};
