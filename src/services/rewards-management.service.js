const { getFirestore, admin } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');

/**
 * Rewards Management Service - CRUD operations for rewards
 * Allows partners/admins to create and manage rewards
 */

/**
 * Create new reward
 */
async function createReward(rewardData, createdBy) {
  const db = getFirestore();

  // Validate required fields
  const requiredFields = ['rewardTitle', 'rewardType', 'brandName', 'deductPoints', 'validFrom', 'validTo'];
  for (const field of requiredFields) {
    if (!rewardData[field]) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, `Missing required field: ${field}`);
    }
  }

  // Validate reward type
  const validTypes = ['coupon', 'percent_off', 'amount_off'];
  if (!validTypes.includes(rewardData.rewardType)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, `Invalid rewardType. Must be one of: ${validTypes.join(', ')}`);
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

  // Create reward document
  const rewardId = db.collection('rewards').doc().id;

  const reward = {
    // Basic info
    rewardTitle: rewardData.rewardTitle,
    rewardSubtitle: rewardData.rewardSubtitle || '',
    rewardType: rewardData.rewardType,
    rewardDetails: rewardData.rewardDetails || [],
    
    // Brand/Partner
    brandName: rewardData.brandName,
    partnerId: rewardData.partnerId || null,
    
    // Points
    deductPoints: rewardData.deductPoints,
    
    // Coupon-specific fields
    availableCoupons: rewardData.rewardType === 'coupon' ? rewardData.totalCoupons : null,
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
    
    // Limits
    maxPerUser: rewardData.maxPerUser || 1,
    
    // Validity
    validFrom: rewardData.validFrom instanceof Date ? rewardData.validFrom : new Date(rewardData.validFrom),
    validTo: rewardData.validTo instanceof Date ? rewardData.validTo : new Date(rewardData.validTo),
    status: rewardData.status || 'active',
    
    // Instructions
    howToClaim: rewardData.howToClaim || [],
    termsAndConditions: rewardData.termsAndConditions || '',
    
    // Images
    previewImage: rewardData.previewImage || '',
    fullImage: rewardData.fullImage || '',
    
    // Engagement
    likeCount: 0,
    dislikeCount: 0,
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
    const validTypes = ['coupon', 'percent_off', 'amount_off'];
    if (!validTypes.includes(updates.rewardType)) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, `Invalid rewardType. Must be one of: ${validTypes.join(', ')}`);
    }
  }

  // Convert date strings to Date objects
  if (updates.validFrom && !(updates.validFrom instanceof Date)) {
    updates.validFrom = new Date(updates.validFrom);
  }
  if (updates.validTo && !(updates.validTo instanceof Date)) {
    updates.validTo = new Date(updates.validTo);
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
