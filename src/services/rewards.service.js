const { getFirestore, admin } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');
const tokenService = require('./token.service');
const pointsService = require('./points.service');
const QRCode = require('qrcode');
const { userOrgCache } = require('../middleware/cache.middleware');

/**
 * Rewards Service - Handles browsing and reserving rewards
 * Supports: coupon, percent_off, amount_off reward types
 */

/**
 * Get all available rewards
 * Optionally filter by userId to show org-specific rewards
 */
async function getAvailableRewards({ category, rewardType, status = 'active', limit = 20, offset = 0, userId = null }) {
  const db = getFirestore();

  // Get user's orgId if userId provided (with caching)
  let userOrgId = null;
  if (userId) {
    // Check cache first
    const cacheKey = `user_org_${userId}`;
    userOrgId = userOrgCache.get(cacheKey);
    
    if (userOrgId === null) {
      // Cache miss - fetch from database
      const userDoc = await db.collection('informations').doc(userId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        userOrgId = userData.orgMembership?.orgId || null;
        // Cache for 30 minutes
        userOrgCache.set(cacheKey, userOrgId, 30 * 60 * 1000);
      }
    }
  }

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

  // Filter rewards based on orgId
  const rewards = snapshot.docs
    .map(doc => {
      const data = doc.data();
      // Use badgeImageUrl as fallback for previewImage if it's empty (for digital_badge type)
      const previewImage = data.previewImage || (data.rewardType === 'digital_badge' ? data.badgeImageUrl : '') || '';
      const fullImage = data.fullImage || (data.rewardType === 'digital_badge' ? data.badgeImageUrl : '') || '';
      
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
        previewImage,
        previewImageGreyed: data.previewImageGreyed,
        fullImage,
        fullImageGreyed: data.fullImageGreyed,
        badgeImageUrl: data.badgeImageUrl, // Include for digital_badge type
        carbonContribution: data.carbonContribution,
        discountPercent: data.discountPercent,
        discountAmount: data.discountAmount,
        minPurchaseAmount: data.minPurchaseAmount,
        rewardDetails: data.rewardDetails,
        howToClaim: data.howToClaim,
        likeCount: data.likeCount || 0,
        dislikeCount: data.dislikeCount || 0,
        usefulnessScore: data.usefulnessScore || 0,
        status: data.status,
        createdAt: data.createdAt?.toDate?.()?.toISOString(),
        updatedAt: data.updatedAt?.toDate?.()?.toISOString(),
        orgId: data.orgId // Include orgId in response
      };
    })
    .filter(reward => {
      // If reward has no orgId, it's available to everyone
      if (!reward.orgId) return true;
      
      // If reward has orgId, only show to users with matching orgId
      return userOrgId && reward.orgId === userOrgId;
    });

  return {
    rewards,
    total: rewards.length,
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
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.RWD_NOT_FOUND, 'Reward not found');
  }

  const reward = rewardDoc.data();

  // Validate org-specific rewards
  if (reward.orgId) {
    // Get user's orgId
    const userDoc = await db.collection('informations').doc(userId).get();
    if (!userDoc.exists) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.USR_NOT_FOUND, 'User not found');
    }
    
    const userData = userDoc.data();
    const userOrgId = userData.orgMembership?.orgId || null;
    
    if (!userOrgId || userOrgId !== reward.orgId) {
      throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.RWD_ORG_RESTRICTED, 'This reward is only available to members of a specific organization');
    }
  }

  // Validate reward is active and not expired
  if (reward.status !== 'active') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.RWD_NOT_ACTIVE, 'This reward is not active');
  }

  const now = new Date();
  if (reward.validTo?.toDate() < now) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.RWD_EXPIRED, 'This reward has expired');
  }

  if (reward.validFrom?.toDate() > now) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.RWD_NOT_AVAILABLE, 'This reward is not yet available');
  }

  // Check availability (for coupon type)
  if (reward.rewardType === 'coupon' && reward.availableCoupons <= 0) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.RWD_OUT_OF_STOCK, 'This reward is currently out of stock');
  }

  // Check max per user limit
  const userRedemptionsSnapshot = await db.collection('userRedemptions')
    .doc(userId)
    .collection('redemptions')
    .where('rewardId', '==', rewardId)
    .where('status', 'in', ['reserved', 'active', 'redeemed'])
    .get();

  if (userRedemptionsSnapshot.size >= (reward.maxPerUser || 999)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.RWD_MAX_LIMIT_REACHED, 'You have already redeemed this reward the maximum number of times');
  }

  // Check user's points balance
  const userPoints = await pointsService.getPointsBalance(userId);
  if (userPoints.balance < reward.deductPoints) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.PTS_INSUFFICIENT_BALANCE, `You need ${reward.deductPoints} points but have ${userPoints.balance}`);
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
 * Redeem reward - Mark redemption as redeemed (for merchants/partners)
 */
async function redeemReward({ qrToken, redemptionId, merchantId = null }) {
  const db = getFirestore();

  // Verify and decode QR token
  let tokenData;
  try {
    tokenData = tokenService.verifyRedemptionToken(qrToken);
  } catch (error) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Invalid or expired QR token');
  }

  // Use redemptionId from token if not provided
  const actualRedemptionId = redemptionId || tokenData.redemptionId;
  const userId = tokenData.userId;

  // Get redemption
  const redemptionRef = db.collection('userRedemptions').doc(userId).collection('redemptions').doc(actualRedemptionId);
  const redemptionDoc = await redemptionRef.get();

  if (!redemptionDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.VALIDATION_ERROR, 'Redemption not found');
  }

  const redemption = redemptionDoc.data();

  // Validate redemption status
  if (redemption.status === 'redeemed') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'This reward has already been redeemed');
  }

  if (redemption.status === 'cancelled') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'This redemption has been cancelled');
  }

  if (redemption.status === 'expired') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'This redemption has expired');
  }

  // Check if expired
  const now = new Date();
  if (redemption.expiresAt && redemption.expiresAt.toDate() < now) {
    // Mark as expired
    await redemptionRef.update({
      status: 'expired',
      expiredAt: now
    });
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'This redemption has expired');
  }

  // Update redemption status to redeemed
  await redemptionRef.update({
    status: 'redeemed',
    redeemedAt: now,
    merchantId: merchantId || null
  });

  // Actually deduct the points now (they were only reserved before)
  await pointsService.deductPoints(userId, redemption.pointsDeducted, actualRedemptionId, 'reward_redeemed');

  return {
    success: true,
    redemptionId: actualRedemptionId,
    rewardTitle: redemption.rewardTitle,
    brandName: redemption.brandName,
    pointsDeducted: redemption.pointsDeducted,
    redeemedAt: now.toISOString(),
    message: 'Reward redeemed successfully'
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
  cancelRedemption,
  redeemReward
};
