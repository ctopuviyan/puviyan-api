const { getFirestore, admin } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');

const DIGITAL_BADGE_TYPES = ['puviStreaker', 'recordDay', 'carbonImpactChampion'];
const DIGITAL_BADGE_REWARD_TYPES = ['digital_badge', 'digital_badge_v2'];
const VALID_REWARD_TYPES = [
  'coupon',
  'percent_off',
  'amount_off',
  ...DIGITAL_BADGE_REWARD_TYPES,
  'meal_coupon',
  'email_approval'
];

function isDigitalBadgeRewardType(rewardType) {
  return DIGITAL_BADGE_REWARD_TYPES.includes(rewardType);
}

/**
 * Rewards Management Service - CRUD operations for rewards
 * Allows partners/admins to create and manage rewards
 */

function validateDigitalBadgeConditions(conditions) {
  if (!conditions || !DIGITAL_BADGE_TYPES.includes(conditions.badgeType)) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      `conditions.badgeType must be one of: ${DIGITAL_BADGE_TYPES.join(', ')}`
    );
  }

  const requiredField = {
    puviStreaker: 'requiredStreakDays',
    recordDay: 'requiredRecordDayCarbonKg',
    carbonImpactChampion: 'requiredChampionCarbonKg'
  }[conditions.badgeType];

  if (Number(conditions[requiredField]) <= 0) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      `conditions.${requiredField} must be greater than zero`
    );
  }
}

function parseRewardDate(value, fieldName, { inclusiveEndDate = false } = {}) {
  const parsedDate = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, `Invalid ${fieldName}`);
  }

  if (
    inclusiveEndDate &&
    parsedDate.getUTCHours() === 0 &&
    parsedDate.getUTCMinutes() === 0 &&
    parsedDate.getUTCSeconds() === 0 &&
    parsedDate.getUTCMilliseconds() === 0
  ) {
    parsedDate.setUTCHours(23, 59, 59, 999);
  }

  return parsedDate;
}

/**
 * Create new reward
 */
async function createReward(rewardData, createdBy) {
  const db = getFirestore();

  // Validate required fields
  const requiredFields = ['rewardTitle', 'rewardType', 'deductPoints', 'validFrom', 'validTo'];
  for (const field of requiredFields) {
    const value = rewardData[field];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, `Missing required field: ${field}`);
    }
  }

  const deductPoints = Number(rewardData.deductPoints);
  if (!Number.isFinite(deductPoints) || deductPoints < 0) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      'deductPoints must be a non-negative number'
    );
  }

  // Validate reward type
  if (!VALID_REWARD_TYPES.includes(rewardData.rewardType)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, `Invalid rewardType. Must be one of: ${VALID_REWARD_TYPES.join(', ')}`);
  }

  // Validate brandName only for types that need it
  if (['coupon', 'percent_off', 'amount_off'].includes(rewardData.rewardType) && !rewardData.brandName) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'brandName is required for coupon, percent_off, and amount_off types');
  }

  // Type-specific validation
  if (rewardData.rewardType === 'coupon') {
    if (!rewardData.totalCoupons || rewardData.totalCoupons <= 0) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'totalCoupons is required for coupon type');
    }
  }

  if (rewardData.rewardType === 'percent_off') {
    if (!rewardData.discountPercent || rewardData.discountPercent <= 0 || rewardData.discountPercent > 100) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'discountPercent must be between 1 and 100 for percent_off type');
    }
  }

  if (rewardData.rewardType === 'amount_off') {
    if (!rewardData.discountAmount || rewardData.discountAmount <= 0) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'discountAmount is required for amount_off type');
    }
  }

  if (isDigitalBadgeRewardType(rewardData.rewardType)) {
    if (deductPoints !== 0) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
        'deductPoints must be zero for digital badge rewards'
      );
    }
    if (!rewardData.badgeImageUrl) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'badgeImageUrl is required for digital badge types');
    }
    if (!rewardData.badgeName) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'badgeName is required for digital badge types');
    }
    validateDigitalBadgeConditions(rewardData.conditions);
  }

  if (rewardData.rewardType === 'meal_coupon') {
    if (!rewardData.mealType) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'mealType is required for meal_coupon type (e.g., breakfast, lunch, dinner)');
    }
    if (!rewardData.totalCoupons || rewardData.totalCoupons <= 0) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'totalCoupons is required for meal_coupon type');
    }
  }

  if (rewardData.rewardType === 'email_approval') {
    if (!rewardData.approvalEmail) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'approvalEmail is required for email_approval type');
    }
    if (!rewardData.approvalSubject) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'approvalSubject is required for email_approval type');
    }
  }

  // Create reward document
  const rewardId = db.collection('rewards').doc().id;

  const reward = {
    // Basic info
    rewardTitle: rewardData.rewardTitle,
    rewardSubtitle: rewardData.rewardSubtitle || '',
    rewardType: rewardData.rewardType,
    rewardDetails: rewardData.rewardDetails || [],
    
    // Brand/Partner
    brandName: rewardData.brandName || null,
    partnerId: rewardData.partnerId || null,
    
    // Points
    deductPoints,
    
    // Coupon-specific fields
    availableCoupons: rewardData.rewardType === 'coupon' ? (rewardData.availableCoupons || rewardData.totalCoupons) : null,
    totalCoupons: rewardData.rewardType === 'coupon' ? rewardData.totalCoupons : null,
    
    // Percent off fields
    discountPercent: rewardData.rewardType === 'percent_off' ? rewardData.discountPercent : null,
    maxDiscountAmount: rewardData.rewardType === 'percent_off' ? (rewardData.maxDiscountAmount || null) : null,
    
    // Amount off fields
    discountAmount: rewardData.rewardType === 'amount_off' ? rewardData.discountAmount : null,
    
    // Common discount fields
    minPurchaseAmount: ['percent_off', 'amount_off'].includes(rewardData.rewardType) 
      ? (rewardData.minPurchaseAmount || null)
      : null,
    
    // Digital Badge fields
    badgeImageUrl: isDigitalBadgeRewardType(rewardData.rewardType) ? rewardData.badgeImageUrl : null,
    badgeName: isDigitalBadgeRewardType(rewardData.rewardType) ? rewardData.badgeName : null,
    badgeDescription: isDigitalBadgeRewardType(rewardData.rewardType) ? (rewardData.badgeDescription || null) : null,
    conditions: isDigitalBadgeRewardType(rewardData.rewardType)
      ? { ...rewardData.conditions, isEnabled: rewardData.conditions.isEnabled !== false }
      : null,
    
    // Meal Coupon fields
    mealType: rewardData.rewardType === 'meal_coupon' ? rewardData.mealType : null,
    availableCoupons: rewardData.rewardType === 'meal_coupon' ? (rewardData.availableCoupons || rewardData.totalCoupons) : (rewardData.rewardType === 'coupon' ? (rewardData.availableCoupons || rewardData.totalCoupons) : null),
    totalCoupons: ['meal_coupon', 'coupon'].includes(rewardData.rewardType) ? rewardData.totalCoupons : null,
    restaurantName: rewardData.rewardType === 'meal_coupon' ? (rewardData.restaurantName || null) : null,
    redemptionType: rewardData.rewardType === 'meal_coupon' ? (rewardData.redemptionType || 'qr_code') : null,
    
    // Email Approval fields
    approvalEmail: rewardData.rewardType === 'email_approval' ? rewardData.approvalEmail : null,
    approvalSubject: rewardData.rewardType === 'email_approval' ? rewardData.approvalSubject : null,
    approvalTemplate: rewardData.rewardType === 'email_approval' ? (rewardData.approvalTemplate || null) : null,
    requiresManualApproval: rewardData.rewardType === 'email_approval' ? true : false,
    
    // Limits
    maxPerUser: rewardData.maxPerUser || 1,
    
    // Validity
    validFrom: parseRewardDate(rewardData.validFrom, 'validFrom'),
    validTo: parseRewardDate(rewardData.validTo, 'validTo', { inclusiveEndDate: true }),
    status: rewardData.status || 'active',
    
    // Instructions
    howToClaim: rewardData.howToClaim || [],
    termsAndConditions: rewardData.termsAndConditions || '',
    
    // Images
    previewImage: rewardData.previewImage || '',
    previewImageGreyed: rewardData.previewImageGreyed || '',
    fullImage: rewardData.fullImage || '',
    fullImageGreyed: rewardData.fullImageGreyed || '',
    
    // Engagement
    likeCount: rewardData.likeCount || 0,
    dislikeCount: rewardData.dislikeCount || 0,
    usefulnessScore: rewardData.usefulnessScore || 0,
    
    // Impact
    carbonContribution: rewardData.carbonContribution || 0,
    
    // Categories
    categories: rewardData.categories || [],
    
    // Organization-specific (optional - null means available to all users)
    orgId: rewardData.orgId || null,
    
    // Timestamps
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: createdBy
  };

  await db.collection('rewards').doc(rewardId).set(reward);

  return {
    rewardId,
    ...reward,
    message: 'Reward created successfully'
  };
}

/**
 * Update existing reward
 */
async function updateReward(rewardId, updates, updatedBy) {
  const db = getFirestore();

  const rewardDoc = await db.collection('rewards').doc(rewardId).get();
  
  if (!rewardDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.VALIDATION_ERROR, 'Reward not found');
  }

  const currentReward = rewardDoc.data();

  // Don't allow changing certain fields
  const disallowedFields = ['createdAt', 'createdBy', 'likeCount', 'dislikeCount', 'availableCoupons'];
  disallowedFields.forEach(field => delete updates[field]);

  // If changing rewardType, validate type-specific fields
  if (updates.rewardType && updates.rewardType !== currentReward.rewardType) {
    if (!VALID_REWARD_TYPES.includes(updates.rewardType)) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, `Invalid rewardType. Must be one of: ${VALID_REWARD_TYPES.join(', ')}`);
    }
  }

  const resultingType = updates.rewardType || currentReward.rewardType;
  if (Object.prototype.hasOwnProperty.call(updates, 'deductPoints')) {
    const deductPoints = Number(updates.deductPoints);
    if (!Number.isFinite(deductPoints) || deductPoints < 0) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
        'deductPoints must be a non-negative number'
      );
    }
    updates.deductPoints = deductPoints;
  }
  const resultingDeductPoints = Object.prototype.hasOwnProperty.call(updates, 'deductPoints')
    ? updates.deductPoints
    : Number(currentReward.deductPoints || 0);
  if (isDigitalBadgeRewardType(resultingType) && resultingDeductPoints !== 0) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      'deductPoints must be zero for digital badge rewards'
    );
  }
  if (isDigitalBadgeRewardType(resultingType) && updates.conditions) {
    validateDigitalBadgeConditions(updates.conditions);
    updates.conditions = {
      ...updates.conditions,
      isEnabled: updates.conditions.isEnabled !== false
    };
  }

  // Convert date strings to Date objects
  if (updates.validFrom) {
    updates.validFrom = parseRewardDate(updates.validFrom, 'validFrom');
  }
  if (updates.validTo) {
    updates.validTo = parseRewardDate(updates.validTo, 'validTo', { inclusiveEndDate: true });
  }

  const updateData = {
    ...updates,
    updatedAt: new Date(),
    updatedBy: updatedBy
  };

  await db.collection('rewards').doc(rewardId).update(updateData);

  return {
    rewardId,
    message: 'Reward updated successfully'
  };
}

/**
 * Delete reward (soft delete - set status to inactive)
 */
async function deleteReward(rewardId, deletedBy) {
  const db = getFirestore();

  const rewardDoc = await db.collection('rewards').doc(rewardId).get();
  
  if (!rewardDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.VALIDATION_ERROR, 'Reward not found');
  }

  await db.collection('rewards').doc(rewardId).update({
    status: 'inactive',
    deletedAt: new Date(),
    deletedBy: deletedBy,
    updatedAt: new Date()
  });

  return {
    rewardId,
    message: 'Reward deleted successfully'
  };
}

/**
 * Get all rewards (admin view with filters)
 */
async function getAllRewardsAdmin({ status, rewardType, brandName, partnerId, limit = 50, offset = 0 }) {
  const db = getFirestore();

  let query = db.collection('rewards')
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .offset(offset);

  if (status) {
    query = query.where('status', '==', status);
  }

  if (rewardType) {
    query = query.where('rewardType', '==', rewardType);
  }

  if (brandName) {
    query = query.where('brandName', '==', brandName);
  }

  if (partnerId) {
    query = query.where('partnerId', '==', partnerId);
  }

  const snapshot = await query.get();

  const rewards = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      rewardId: doc.id,
      ...data,
      validFrom: data.validFrom?.toDate?.()?.toISOString(),
      validTo: data.validTo?.toDate?.()?.toISOString(),
      createdAt: data.createdAt?.toDate?.()?.toISOString(),
      updatedAt: data.updatedAt?.toDate?.()?.toISOString()
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
 * Update reward stock (for coupon type)
 */
async function updateRewardStock(rewardId, totalCoupons, updatedBy) {
  const db = getFirestore();

  const rewardDoc = await db.collection('rewards').doc(rewardId).get();
  
  if (!rewardDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.VALIDATION_ERROR, 'Reward not found');
  }

  const reward = rewardDoc.data();

  if (reward.rewardType !== 'coupon') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Stock updates only applicable for coupon type rewards');
  }

  const currentAvailable = reward.availableCoupons || 0;
  const currentTotal = reward.totalCoupons || 0;
  const redeemed = currentTotal - currentAvailable;

  // New available = new total - already redeemed
  const newAvailable = Math.max(0, totalCoupons - redeemed);

  await db.collection('rewards').doc(rewardId).update({
    totalCoupons: totalCoupons,
    availableCoupons: newAvailable,
    updatedAt: new Date(),
    updatedBy: updatedBy
  });

  return {
    rewardId,
    totalCoupons,
    availableCoupons: newAvailable,
    redeemed,
    message: 'Stock updated successfully'
  };
}

/**
 * Get reward analytics
 */
async function getRewardAnalytics(rewardId) {
  const db = getFirestore();

  const rewardDoc = await db.collection('rewards').doc(rewardId).get();
  
  if (!rewardDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.VALIDATION_ERROR, 'Reward not found');
  }

  const reward = rewardDoc.data();

  // Get redemption stats from userRedemptions
  const redemptionsSnapshot = await db.collectionGroup('redemptions')
    .where('rewardId', '==', rewardId)
    .get();

  const redemptions = redemptionsSnapshot.docs.map(doc => doc.data());

  const totalRedemptions = redemptions.length;
  const reservedCount = redemptions.filter(r => r.status === 'reserved').length;
  const activeCount = redemptions.filter(r => r.status === 'active').length;
  const redeemedCount = redemptions.filter(r => r.status === 'redeemed').length;
  const cancelledCount = redemptions.filter(r => r.status === 'cancelled').length;

  const totalPointsDeducted = redemptions
    .filter(r => ['reserved', 'active', 'redeemed'].includes(r.status))
    .reduce((sum, r) => sum + r.pointsDeducted, 0);

  const totalDiscountGiven = redemptions
    .filter(r => r.status === 'redeemed')
    .reduce((sum, r) => sum + (r.appliedDiscount || 0), 0);

  return {
    rewardId,
    rewardTitle: reward.rewardTitle,
    rewardType: reward.rewardType,
    status: reward.status,
    stock: reward.rewardType === 'coupon' ? {
      total: reward.totalCoupons,
      available: reward.availableCoupons,
      redeemed: reward.totalCoupons - reward.availableCoupons
    } : null,
    redemptions: {
      total: totalRedemptions,
      reserved: reservedCount,
      active: activeCount,
      redeemed: redeemedCount,
      cancelled: cancelledCount
    },
    points: {
      totalDeducted: totalPointsDeducted,
      averagePerRedemption: totalRedemptions > 0 ? Math.round(totalPointsDeducted / totalRedemptions) : 0
    },
    discount: {
      totalGiven: totalDiscountGiven,
      averagePerRedemption: redeemedCount > 0 ? Math.round(totalDiscountGiven / redeemedCount) : 0
    },
    engagement: {
      likes: reward.likeCount || 0,
      dislikes: reward.dislikeCount || 0,
      usefulnessScore: reward.usefulnessScore || 0
    }
  };
}

module.exports = {
  createReward,
  updateReward,
  deleteReward,
  getAllRewardsAdmin,
  updateRewardStock,
  getRewardAnalytics
};
