const { getFirestore } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');
const tokenService = require('./token.service');

/**
 * Unified Redemption Service - Handles partner scanning and confirmation
 * Supports: coupon, percent_off, amount_off reward types
 */

/**
 * Scan QR code - Partner scans user's redemption QR
 */
async function scanRedemption({ qrToken, partnerId }) {
  const db = getFirestore();

  // Verify and decode token
  const decoded = tokenService.verifyRedemptionToken(qrToken);

  // Get redemption record from userRedemptions
  const redemptionRef = db.collection('userRedemptions')
    .doc(decoded.userId)
    .collection('redemptions')
    .doc(decoded.redemptionId);

  const redemptionDoc = await redemptionRef.get();

  if (!redemptionDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.RDM_NOT_FOUND, 'Redemption not found');
  }

  const redemption = redemptionDoc.data();

  // Verify partner matches (if partnerId is set in reward)
  if (redemption.partnerId && redemption.partnerId !== partnerId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.PTR_INVALID, 'This reward is not valid at your location');
  }

  // Check if already redeemed
  if (redemption.status === 'redeemed') {
    throw new ApiError(HTTP_STATUS.CONFLICT, ERROR_CODES.RDM_ALREADY_USED, 'This reward has already been used');
  }

  // Check if expired
  if (new Date() > redemption.expiresAt.toDate()) {
    await redemptionRef.update({ status: 'expired' });
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.RDM_EXPIRED, 'This reward has expired');
  }

  // Check if cancelled
  if (redemption.status === 'cancelled') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.RDM_CANCELLED, 'This reward has been cancelled');
  }

  // Update status to active (scanned)
  await redemptionRef.update({
    status: 'active',
    activatedAt: new Date(),
    scannedBy: partnerId
  });

  // Get user info for display
  const userDoc = await db.collection('informationsPrivate').doc(decoded.userId).get();
  const userData = userDoc.exists ? userDoc.data() : {};

  // Return different response based on reward type
  const response = {
    redemptionId: decoded.redemptionId,
    rewardType: redemption.rewardType,
    rewardTitle: redemption.rewardTitle,
    brandName: redemption.brandName,
    status: 'active',
    user: {
      userId: decoded.userId,
      email: userData.email || 'Unknown'
    }
  };

  // Add type-specific fields
  switch (redemption.rewardType) {
    case 'coupon':
      response.couponCode = redemption.couponCode;
      response.instructions = redemption.metadata?.rewardSnapshot?.howToClaim || [];
      break;

    case 'percent_off':
      response.discountPercent = redemption.discountPercent;
      response.maxDiscountAmount = redemption.maxDiscountAmount;
      response.minPurchaseAmount = redemption.minPurchaseAmount;
      break;

    case 'amount_off':
      response.discountAmount = redemption.discountAmount;
      response.minPurchaseAmount = redemption.minPurchaseAmount;
      break;
  }

  return response;
}

/**
 * Calculate discount - For percent_off and amount_off types
 */
async function calculateDiscount({ redemptionId, userId, billAmount }) {
  const db = getFirestore();

  const redemptionRef = db.collection('userRedemptions')
    .doc(userId)
    .collection('redemptions')
    .doc(redemptionId);

  const redemptionDoc = await redemptionRef.get();

  if (!redemptionDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.RDM_NOT_FOUND, 'Redemption not found');
  }

  const redemption = redemptionDoc.data();

  // Only applicable for percent_off and amount_off
  if (redemption.rewardType === 'coupon') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_VALIDATION_ERROR, 'Discount calculation not applicable for coupon type');
  }

  // Check minimum purchase amount
  if (redemption.minPurchaseAmount && billAmount < redemption.minPurchaseAmount) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST, 
      'BELOW_MINIMUM_PURCHASE', 
      `Minimum purchase amount is ₹${redemption.minPurchaseAmount}`
    );
  }

  let appliedDiscount = 0;
  let message = '';

  if (redemption.rewardType === 'percent_off') {
    // Calculate percentage discount
    const calculatedDiscount = Math.floor((billAmount * redemption.discountPercent) / 100);
    
    // Apply max discount cap if exists
    appliedDiscount = redemption.maxDiscountAmount 
      ? Math.min(calculatedDiscount, redemption.maxDiscountAmount)
      : calculatedDiscount;

    message = `${redemption.discountPercent}% discount applied (₹${appliedDiscount} off)`;
    
    if (calculatedDiscount > appliedDiscount) {
      message += ` - capped at ₹${redemption.maxDiscountAmount}`;
    }

  } else if (redemption.rewardType === 'amount_off') {
    // Fixed amount discount
    appliedDiscount = redemption.discountAmount;
    message = `₹${appliedDiscount} discount applied`;
  }

  const finalAmount = billAmount - appliedDiscount;

  return {
    billAmount,
    discountPercent: redemption.discountPercent || null,
    discountAmount: redemption.discountAmount || null,
    maxDiscountAmount: redemption.maxDiscountAmount || null,
    appliedDiscount,
    finalAmount,
    message
  };
}

/**
 * Confirm redemption - Partner confirms after service/payment
 */
async function confirmRedemption({ redemptionId, userId, partnerId, partnerTransactionId, billAmount, appliedDiscount }) {
  const db = getFirestore();
  const pointsService = require('./points.service');

  const redemptionRef = db.collection('userRedemptions')
    .doc(userId)
    .collection('redemptions')
    .doc(redemptionId);

  const redemptionDoc = await redemptionRef.get();

  if (!redemptionDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.RDM_NOT_FOUND, 'Redemption not found');
  }

  const redemption = redemptionDoc.data();

  // Verify partner (if partnerId is set)
  if (redemption.partnerId && redemption.partnerId !== partnerId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.PTR_INVALID, 'Partner mismatch');
  }

  // Verify status
  if (redemption.status !== 'active') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_VALIDATION_ERROR, 'Redemption must be in active status');
  }

  // Validate required fields for discount-based rewards
  if (redemption.rewardType !== 'coupon') {
    if (!billAmount || billAmount <= 0) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VAL_MISSING_FIELD,
        'billAmount is required and must be greater than 0 for discount-based rewards'
      );
    }
    if (appliedDiscount === undefined || appliedDiscount === null || appliedDiscount < 0) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VAL_MISSING_FIELD,
        'appliedDiscount is required and must be 0 or greater for discount-based rewards'
      );
    }
  }

  // ACTUALLY DEDUCT POINTS NOW (they were only reserved before)
  await pointsService.deductPoints(userId, redemption.pointsDeducted, redemptionId);

  // Update redemption status
  const updateData = {
    status: 'redeemed',
    redeemedAt: new Date(),
    redeemedBy: partnerId
  };

  // Add optional fields only if they have values
  if (partnerTransactionId) {
    updateData.partnerTransactionId = partnerTransactionId;
  }

  // Add bill and discount info for percent_off/amount_off (only if provided)
  if (redemption.rewardType !== 'coupon') {
    if (billAmount !== undefined && billAmount !== null) {
      updateData.billAmount = billAmount;
    }
    if (appliedDiscount !== undefined && appliedDiscount !== null) {
      updateData.appliedDiscount = appliedDiscount;
    }
  }

  await redemptionRef.update(updateData);

  // Create global transaction log (optional, for analytics)
  await db.collection('redemptionTransactions').add({
    redemptionId,
    userId,
    rewardId: redemption.rewardId,
    partnerId,
    type: 'redeem',
    rewardType: redemption.rewardType,
    pointsDeducted: redemption.pointsDeducted,
    discountApplied: appliedDiscount || 0,
    billAmount: billAmount || 0,
    status: 'success',
    timestamp: new Date()
  });

  return {
    success: true,
    redemptionId,
    status: 'redeemed',
    message: 'Redemption confirmed successfully'
  };
}

/**
 * Rollback redemption - Cancel and refund (if needed)
 */
async function rollbackRedemption({ redemptionId, userId, partnerId, reason }) {
  const db = getFirestore();

  const redemptionRef = db.collection('userRedemptions')
    .doc(userId)
    .collection('redemptions')
    .doc(redemptionId);

  const redemptionDoc = await redemptionRef.get();

  if (!redemptionDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.RDM_NOT_FOUND, 'Redemption not found');
  }

  const redemption = redemptionDoc.data();

  // Verify partner
  if (redemption.partnerId && redemption.partnerId !== partnerId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.PTR_INVALID, 'Partner mismatch');
  }

  // Can only rollback active redemptions
  if (redemption.status !== 'active') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_VALIDATION_ERROR, 'Can only rollback active redemptions');
  }

  // Update status
  await redemptionRef.update({
    status: 'cancelled',
    cancelledAt: new Date(),
    cancelledBy: partnerId,
    cancellationReason: reason || 'Cancelled by partner'
  });

  // Log transaction
  await db.collection('redemptionTransactions').add({
    redemptionId,
    userId,
    rewardId: redemption.rewardId,
    partnerId,
    type: 'cancel',
    rewardType: redemption.rewardType,
    status: 'success',
    timestamp: new Date(),
    metadata: { reason }
  });

  return {
    redemptionId,
    status: 'cancelled',
    message: 'Redemption cancelled successfully'
  };
}

/**
 * Get partner's redemptions
 */
async function getPartnerRedemptions({ partnerId, startDate, endDate, limit = 50, offset = 0 }) {
  const db = getFirestore();

  let query = db.collectionGroup('redemptions')
    .where('redeemedBy', '==', partnerId)
    .where('status', '==', 'redeemed')
    .orderBy('redeemedAt', 'desc')
    .limit(limit)
    .offset(offset);

  if (startDate) {
    query = query.where('redeemedAt', '>=', new Date(startDate));
  }

  if (endDate) {
    query = query.where('redeemedAt', '<=', new Date(endDate));
  }

  const snapshot = await query.get();

  const redemptions = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      redemptionId: doc.id,
      rewardTitle: data.rewardTitle,
      rewardType: data.rewardType,
      redeemedAt: data.redeemedAt?.toDate?.()?.toISOString(),
      partnerTransactionId: data.partnerTransactionId,
      pointsDeducted: data.pointsDeducted,
      appliedDiscount: data.appliedDiscount || 0,
      billAmount: data.billAmount || 0
    };
  });

  // Calculate stats
  const totalDiscountGiven = redemptions.reduce((sum, r) => sum + (r.appliedDiscount || 0), 0);

  return {
    redemptions,
    total: snapshot.size,
    stats: {
      totalRedemptions: snapshot.size,
      totalDiscountGiven
    }
  };
}

module.exports = {
  scanRedemption,
  calculateDiscount,
  confirmRedemption,
  rollbackRedemption,
  getPartnerRedemptions
};
