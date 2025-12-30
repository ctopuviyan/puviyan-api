const { getFirestore, admin } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');
const tokenService = require('./token.service');
const pointsService = require('./points.service');
const QRCode = require('qrcode');

/**
 * Rewards Service - Handles browsing and reserving rewards
 * Supports: coupon, percent_off, amount_off reward types
 */

/**
 * Get all available rewards
 */
async function getAvailableRewards({ category, rewardType, status = 'active', limit = 20, offset = 0 }) {
  const db = getFirestore();

  let query = db.collection('rewards')
    .where('status', '==', status)
    .where('validTo', '>', new Date());

  if (category) {
    query = query.where('categories', 'array-contains', category);
  }

  if (rewardType) {
    query = query.where('rewardType', '==', rewardType);
  }

  query = query.orderBy('validTo', 'desc')
    .limit(limit)
    .offset(offset);

  const snapshot = await query.get();

  const rewards = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      rewardId: doc.id,
      rewardTitle: data.rewardTitle,
      rewardSubtitle: data.rewardSubtitle,
      rewardType: data.rewardType || 'coupon',
      brandName: data.brandName,
      deductPoints: data.deductPoints,
      availableCoupons: data.availableCoupons,
      maxPerUser: data.maxPerUser,
      validFrom: data.validFrom?.toDate?.()?.toISOString(),
      validTo: data.validTo?.toDate?.()?.toISOString(),
      previewImage: data.previewImage,
      carbonContribution: data.carbonContribution,
      discountPercent: data.discountPercent,
      discountAmount: data.discountAmount,
      minPurchaseAmount: data.minPurchaseAmount
    };
  });

  return {
    rewards,
    total: snapshot.size,
    limit,
    offset
  };
}

/**
 * Get reward details by ID
 */
async function getRewardDetails(rewardId) {
  const db = getFirestore();

  const rewardDoc = await db.collection('rewards').doc(rewardId).get();

  if (!rewardDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.VALIDATION_ERROR, 'Reward not found');
  }

  const data = rewardDoc.data();

  return {
    rewardId: rewardDoc.id,
    ...data,
    validFrom: data.validFrom?.toDate?.()?.toISOString(),
    validTo: data.validTo?.toDate?.()?.toISOString(),
    createdAt: data.createdAt?.toDate?.()?.toISOString(),
    updatedAt: data.updatedAt?.toDate?.()?.toISOString()
  };
}

/**
 * Reserve reward - Deduct points and create redemption
 */
async function reserveReward({ userId, rewardId }) {
  const db = getFirestore();

  // Get reward details
  const rewardDoc = await db.collection('rewards').doc(rewardId).get();
  
  if (!rewardDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.VALIDATION_ERROR, 'Reward not found');
  }

  const reward = rewardDoc.data();

  // Validate reward is active and not expired
  if (reward.status !== 'active') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'This reward is not active');
  }

  const now = new Date();
  if (reward.validTo?.toDate() < now) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'This reward has expired');
  }

  if (reward.validFrom?.toDate() > now) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'This reward is not yet available');
  }

  // Check availability (for coupon type)
  if (reward.rewardType === 'coupon' && reward.availableCoupons <= 0) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'OUT_OF_STOCK', 'This reward is currently out of stock');
  }

  // Check max per user limit
  const userRedemptionsSnapshot = await db.collection('userRedemptions')
    .doc(userId)
    .collection('redemptions')
    .where('rewardId', '==', rewardId)
    .where('status', 'in', ['reserved', 'active', 'redeemed'])
    .get();

  if (userRedemptionsSnapshot.size >= (reward.maxPerUser || 999)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'MAX_REDEMPTIONS_REACHED', 'You have already redeemed this reward the maximum number of times');
  }

  // Check user's points balance
  const userPoints = await pointsService.getPointsBalance(userId);
  if (userPoints.balance < reward.deductPoints) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INSUFFICIENT_POINTS, `You need ${reward.deductPoints} points but have ${userPoints.balance}`);
  }

  // Create redemption using transaction
  const redemptionId = db.collection('userRedemptions').doc(userId).collection('redemptions').doc().id;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  try {
    await db.runTransaction(async (transaction) => {
      // Reserve points (lock but don't deduct yet)
      await pointsService.reservePoints(userId, reward.deductPoints, redemptionId);

      // Decrement available coupons (for coupon type)
      if (reward.rewardType === 'coupon') {
        const rewardRef = db.collection('rewards').doc(rewardId);
        transaction.update(rewardRef, {
          availableCoupons: admin.firestore.FieldValue.increment(-1)
        });
      }

      // Generate coupon code (for coupon type)
      const couponCode = reward.rewardType === 'coupon' 
        ? generateCouponCode(reward.brandName, redemptionId)
        : null;

      // Create redemption record
      const redemptionData = {
        redemptionId,
        userId,
        rewardId,
        rewardTitle: reward.rewardTitle,
        rewardType: reward.rewardType || 'coupon',
        brandName: reward.brandName,
        partnerId: reward.partnerId || null,
        pointsDeducted: reward.deductPoints,
        couponCode,
        discountPercent: reward.discountPercent || null,
        discountAmount: reward.discountAmount || null,
        maxDiscountAmount: reward.maxDiscountAmount || null,
        minPurchaseAmount: reward.minPurchaseAmount || null,
        status: 'reserved',
        reservedAt: new Date(),
        expiresAt,
        metadata: {
          rewardSnapshot: {
            rewardTitle: reward.rewardTitle,
            rewardSubtitle: reward.rewardSubtitle,
            howToClaim: reward.howToClaim,
            termsAndConditions: reward.termsAndConditions
          }
        }
      };

      const redemptionRef = db.collection('userRedemptions').doc(userId).collection('redemptions').doc(redemptionId);
      transaction.set(redemptionRef, redemptionData);
    });

    // Generate QR code after transaction
    const qrToken = tokenService.generateRedemptionToken({
      redemptionId,
      userId,
      rewardId,
      rewardType: reward.rewardType || 'coupon',
      expiresAt: expiresAt.toISOString()
    });

    const qrCodeUrl = await QRCode.toDataURL(qrToken);

    // Update with QR code
    await db.collection('userRedemptions').doc(userId).collection('redemptions').doc(redemptionId).update({
      qrToken,
      qrCodeUrl
    });

    return {
      redemptionId,
      rewardType: reward.rewardType || 'coupon',
      couponCode: reward.rewardType === 'coupon' ? generateCouponCode(reward.brandName, redemptionId) : null,
      qrToken,
      qrCodeUrl,
      pointsDeducted: reward.deductPoints,
      expiresAt: expiresAt.toISOString(),
      message: 'Reward reserved successfully'
    };

  } catch (error) {
    throw error;
  }
}

/**
 * Get user's redemptions
 */
async function getUserRedemptions({ userId, status, limit = 20, offset = 0 }) {
  const db = getFirestore();

  let query = db.collection('userRedemptions')
    .doc(userId)
    .collection('redemptions')
    .orderBy('reservedAt', 'desc')
    .limit(limit)
    .offset(offset);

  if (status) {
    query = query.where('status', '==', status);
  }

  const snapshot = await query.get();

  const redemptions = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      redemptionId: doc.id,
      ...data,
      reservedAt: data.reservedAt?.toDate?.()?.toISOString(),
      activatedAt: data.activatedAt?.toDate?.()?.toISOString(),
      redeemedAt: data.redeemedAt?.toDate?.()?.toISOString(),
      expiresAt: data.expiresAt?.toDate?.()?.toISOString()
    };
  });

  return {
    redemptions,
    total: snapshot.size,
    limit,
    offset
  };
}

/**
 * Cancel redemption and refund points
 */
async function cancelRedemption({ userId, redemptionId, reason }) {
  const db = getFirestore();

  const redemptionRef = db.collection('userRedemptions').doc(userId).collection('redemptions').doc(redemptionId);
  const redemptionDoc = await redemptionRef.get();

  if (!redemptionDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.VALIDATION_ERROR, 'Redemption not found');
  }

  const redemption = redemptionDoc.data();

  // Can only cancel reserved or active redemptions
  if (!['reserved', 'active'].includes(redemption.status)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Cannot cancel this redemption');
  }

  // Release reserved points (not refund, since they weren't deducted yet)
  await pointsService.releasePoints(userId, redemption.pointsDeducted, redemptionId);

  // Increment available coupons back (for coupon type)
  if (redemption.rewardType === 'coupon') {
    await db.collection('rewards').doc(redemption.rewardId).update({
      availableCoupons: admin.firestore.FieldValue.increment(1)
    });
  }

  // Update redemption status
  await redemptionRef.update({
    status: 'cancelled',
    cancelledAt: new Date(),
    cancellationReason: reason || 'Cancelled by user'
  });

  return {
    success: true,
    pointsRefunded: redemption.pointsDeducted,
    message: 'Redemption cancelled and points refunded'
  };
}

/**
 * Generate unique coupon code
 */
function generateCouponCode(brandName, redemptionId) {
  const prefix = brandName.substring(0, 2).toUpperCase();
  const suffix = redemptionId.substring(0, 6).toUpperCase();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${prefix}-${suffix}-${random}`;
}

module.exports = {
  getAvailableRewards,
  getRewardDetails,
  reserveReward,
  getUserRedemptions,
  cancelRedemption
};
