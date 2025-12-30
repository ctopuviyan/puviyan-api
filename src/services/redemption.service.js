const { getFirestore } = require('../config/firebase.config');
const { COLLECTIONS, REDEMPTION_STATUS, REDEMPTION_METHOD, ERROR_CODES, HTTP_STATUS, POINTS, TOKEN_EXPIRY } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');
const tokenService = require('./token.service');
const pointsService = require('./points.service');

/**
 * Initiate redemption - User generates QR code
 */
async function initiateRedemption({ userId, points, partnerId }) {
  const db = getFirestore();

  // Validate inputs
  if (!userId || !points || !partnerId) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Missing required fields');
  }

  if (points < POINTS.MIN_REDEMPTION) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INSUFFICIENT_POINTS, `Minimum redemption is ${POINTS.MIN_REDEMPTION} points`);
  }

  // Check user's points balance
  const userPoints = await pointsService.getPointsBalance(userId);
  if (userPoints.balance < points) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INSUFFICIENT_POINTS, 'Insufficient points balance');
  }

  // Verify partner exists and is active
  const partnerDoc = await db.collection(COLLECTIONS.PARTNERS).doc(partnerId).get();
  if (!partnerDoc.exists || !partnerDoc.data().isActive) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.INVALID_PARTNER, 'Invalid or inactive partner');
  }

  const partner = partnerDoc.data();

  // Calculate discount
  const discount = await pointsService.calculateDiscount({ userId, points, partnerId });

  // Create redemption record
  const redemptionId = db.collection(COLLECTIONS.REDEMPTIONS).doc().id;
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY.REDEMPTION * 1000);

  const redemptionData = {
    redemptionId,
    userId,
    partnerId,
    partnerName: partner.name,
    points,
    discount: discount.discount,
    status: REDEMPTION_STATUS.INITIATED,
    method: REDEMPTION_METHOD.QR,
    createdAt: new Date(),
    expiresAt,
    metadata: {
      userAgent: 'mobile-app',
      appVersion: '1.0.0'
    }
  };

  await db.collection(COLLECTIONS.REDEMPTIONS).doc(redemptionId).set(redemptionData);

  // Generate JWT token for QR code
  const qrToken = tokenService.generateRedemptionToken({
    redemptionId,
    userId,
    partnerId,
    points,
    discount: discount.discount,
    expiresAt: expiresAt.toISOString()
  });

  return {
    redemptionId,
    qrToken,
    discount: discount.discount,
    points,
    expiresAt: expiresAt.toISOString(),
    partner: {
      id: partnerId,
      name: partner.name,
      logo: partner.logo
    }
  };
}

/**
 * Scan QR code - Partner scans and validates
 */
async function scanRedemption({ qrToken, partnerId }) {
  const db = getFirestore();

  // Verify and decode token
  const decoded = tokenService.verifyRedemptionToken(qrToken);

  // Verify partner matches
  if (decoded.partnerId !== partnerId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.INVALID_PARTNER, 'QR code is not valid for this partner');
  }

  // Get redemption record
  const redemptionDoc = await db.collection(COLLECTIONS.REDEMPTIONS).doc(decoded.redemptionId).get();
  if (!redemptionDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.REDEMPTION_NOT_FOUND, 'Redemption not found');
  }

  const redemption = redemptionDoc.data();

  // Check if already redeemed
  if (redemption.status === REDEMPTION_STATUS.CONFIRMED) {
    throw new ApiError(HTTP_STATUS.CONFLICT, ERROR_CODES.ALREADY_REDEEMED, 'This redemption has already been used');
  }

  // Check if expired
  if (new Date() > redemption.expiresAt.toDate()) {
    await db.collection(COLLECTIONS.REDEMPTIONS).doc(decoded.redemptionId).update({
      status: REDEMPTION_STATUS.EXPIRED
    });
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.EXPIRED_TOKEN, 'Redemption has expired');
  }

  // Reserve points (two-phase commit - phase 1)
  await db.collection(COLLECTIONS.REDEMPTIONS).doc(decoded.redemptionId).update({
    status: REDEMPTION_STATUS.RESERVED,
    reservedAt: new Date(),
    scannedBy: partnerId
  });

  return {
    redemptionId: decoded.redemptionId,
    discount: redemption.discount,
    points: redemption.points,
    status: REDEMPTION_STATUS.RESERVED,
    message: 'Redemption reserved. Please confirm after payment.'
  };
}

/**
 * Confirm redemption - After successful payment
 */
async function confirmRedemption({ redemptionId, partnerId, partnerTransactionId, appliedDiscount }) {
  const db = getFirestore();

  const redemptionDoc = await db.collection(COLLECTIONS.REDEMPTIONS).doc(redemptionId).get();
  if (!redemptionDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.REDEMPTION_NOT_FOUND, 'Redemption not found');
  }

  const redemption = redemptionDoc.data();

  // Verify partner
  if (redemption.partnerId !== partnerId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.INVALID_PARTNER, 'Partner mismatch');
  }

  // Verify status
  if (redemption.status !== REDEMPTION_STATUS.RESERVED) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Redemption must be in reserved status');
  }

  // Verify discount amount matches (fraud prevention)
  if (appliedDiscount && Math.abs(appliedDiscount - redemption.discount) > 0.01) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Applied discount does not match approved amount');
  }

  // Two-phase commit - phase 2: Deduct points
  await pointsService.deductPoints(redemption.userId, redemption.points, redemptionId);

  // Update redemption status
  await db.collection(COLLECTIONS.REDEMPTIONS).doc(redemptionId).update({
    status: REDEMPTION_STATUS.CONFIRMED,
    confirmedAt: new Date(),
    partnerTransactionId,
    appliedDiscount: appliedDiscount || redemption.discount
  });

  return {
    redemptionId,
    status: REDEMPTION_STATUS.CONFIRMED,
    message: 'Redemption confirmed successfully',
    pointsDeducted: redemption.points,
    discountApplied: redemption.discount
  };
}

/**
 * Rollback redemption - Cancel and refund points
 */
async function rollbackRedemption({ redemptionId, partnerId, reason }) {
  const db = getFirestore();

  const redemptionDoc = await db.collection(COLLECTIONS.REDEMPTIONS).doc(redemptionId).get();
  if (!redemptionDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.REDEMPTION_NOT_FOUND, 'Redemption not found');
  }

  const redemption = redemptionDoc.data();

  // Verify partner
  if (redemption.partnerId !== partnerId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.INVALID_PARTNER, 'Partner mismatch');
  }

  // Can only rollback reserved or confirmed redemptions
  if (![REDEMPTION_STATUS.RESERVED, REDEMPTION_STATUS.CONFIRMED].includes(redemption.status)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Cannot rollback this redemption');
  }

  // If confirmed, refund points
  if (redemption.status === REDEMPTION_STATUS.CONFIRMED) {
    await pointsService.refundPoints(redemption.userId, redemption.points, redemptionId);
  }

  // Update status
  await db.collection(COLLECTIONS.REDEMPTIONS).doc(redemptionId).update({
    status: REDEMPTION_STATUS.CANCELLED,
    cancelledAt: new Date(),
    cancellationReason: reason || 'Cancelled by partner'
  });

  return {
    redemptionId,
    status: REDEMPTION_STATUS.CANCELLED,
    message: 'Redemption cancelled successfully',
    pointsRefunded: redemption.status === REDEMPTION_STATUS.CONFIRMED ? redemption.points : 0
  };
}

/**
 * Get user's redemption history
 */
async function getRedemptionHistory({ userId, limit, offset }) {
  const db = getFirestore();

  const snapshot = await db.collection(COLLECTIONS.REDEMPTIONS)
    .where('userId', '==', userId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .offset(offset)
    .get();

  const redemptions = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdAt: doc.data().createdAt?.toDate?.()?.toISOString(),
    confirmedAt: doc.data().confirmedAt?.toDate?.()?.toISOString(),
    expiresAt: doc.data().expiresAt?.toDate?.()?.toISOString()
  }));

  return {
    redemptions,
    total: snapshot.size,
    limit,
    offset
  };
}

/**
 * Get redemption details
 */
async function getRedemptionDetails({ redemptionId, userId }) {
  const db = getFirestore();

  const redemptionDoc = await db.collection(COLLECTIONS.REDEMPTIONS).doc(redemptionId).get();
  if (!redemptionDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.REDEMPTION_NOT_FOUND, 'Redemption not found');
  }

  const redemption = redemptionDoc.data();

  // Verify user owns this redemption
  if (redemption.userId !== userId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'FORBIDDEN', 'Access denied');
  }

  return {
    id: redemptionDoc.id,
    ...redemption,
    createdAt: redemption.createdAt?.toDate?.()?.toISOString(),
    confirmedAt: redemption.confirmedAt?.toDate?.()?.toISOString(),
    expiresAt: redemption.expiresAt?.toDate?.()?.toISOString()
  };
}

module.exports = {
  initiateRedemption,
  scanRedemption,
  confirmRedemption,
  rollbackRedemption,
  getRedemptionHistory,
  getRedemptionDetails
};
