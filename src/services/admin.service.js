const { getFirestore } = require('../config/firebase.config');
const { COLLECTIONS, ERROR_CODES, HTTP_STATUS, REDEMPTION_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');
const tokenService = require('./token.service');

/**
 * Create new partner
 */
async function createPartner(partnerData, adminUserId) {
  const db = getFirestore();

  // Validate required fields
  const requiredFields = ['name', 'category', 'location'];
  for (const field of requiredFields) {
    if (!partnerData[field]) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, `Missing required field: ${field}`);
    }
  }

  // Generate API key for partner
  const partnerId = db.collection(COLLECTIONS.PARTNERS).doc().id;
  const apiKey = tokenService.generatePartnerApiKey(partnerId);

  const partner = {
    name: partnerData.name,
    logo: partnerData.logo || '',
    category: partnerData.category,
    location: partnerData.location,
    redemptionRate: partnerData.redemptionRate || 10,
    isActive: true,
    apiKey,
    offers: partnerData.offers || [],
    createdAt: new Date(),
    createdBy: adminUserId,
    stats: {
      totalRedemptions: 0,
      totalPointsRedeemed: 0
    }
  };

  await db.collection(COLLECTIONS.PARTNERS).doc(partnerId).set(partner);

  return {
    id: partnerId,
    ...partner,
    message: 'Partner created successfully'
  };
}

/**
 * Update partner
 */
async function updatePartner(partnerId, updates, adminUserId) {
  const db = getFirestore();

  const partnerDoc = await db.collection(COLLECTIONS.PARTNERS).doc(partnerId).get();
  if (!partnerDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.INVALID_PARTNER, 'Partner not found');
  }

  // Don't allow updating certain fields
  const disallowedFields = ['apiKey', 'createdAt', 'createdBy', 'stats'];
  disallowedFields.forEach(field => delete updates[field]);

  const updateData = {
    ...updates,
    updatedAt: new Date(),
    updatedBy: adminUserId
  };

  await db.collection(COLLECTIONS.PARTNERS).doc(partnerId).update(updateData);

  return {
    id: partnerId,
    message: 'Partner updated successfully'
  };
}

/**
 * Delete partner (soft delete - set isActive to false)
 */
async function deletePartner(partnerId, adminUserId) {
  const db = getFirestore();

  const partnerDoc = await db.collection(COLLECTIONS.PARTNERS).doc(partnerId).get();
  if (!partnerDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.INVALID_PARTNER, 'Partner not found');
  }

  await db.collection(COLLECTIONS.PARTNERS).doc(partnerId).update({
    isActive: false,
    deletedAt: new Date(),
    deletedBy: adminUserId
  });

  return {
    id: partnerId,
    message: 'Partner deleted successfully'
  };
}

/**
 * Get system analytics
 */
async function getSystemAnalytics(period) {
  const db = getFirestore();

  // Calculate date range
  const now = new Date();
  let startDate = new Date();

  switch (period) {
    case '7d':
      startDate.setDate(now.getDate() - 7);
      break;
    case '30d':
      startDate.setDate(now.getDate() - 30);
      break;
    case '90d':
      startDate.setDate(now.getDate() - 90);
      break;
    default:
      startDate.setDate(now.getDate() - 30);
  }

  // Get all redemptions in period
  const redemptionsSnapshot = await db.collection(COLLECTIONS.REDEMPTIONS)
    .where('createdAt', '>=', startDate)
    .get();

  const redemptions = redemptionsSnapshot.docs.map(doc => doc.data());

  // Calculate stats by status
  const statsByStatus = {};
  Object.values(REDEMPTION_STATUS).forEach(status => {
    statsByStatus[status] = redemptions.filter(r => r.status === status).length;
  });

  const confirmedRedemptions = redemptions.filter(r => r.status === REDEMPTION_STATUS.CONFIRMED);
  const totalPointsRedeemed = confirmedRedemptions.reduce((sum, r) => sum + r.points, 0);
  const totalDiscountGiven = confirmedRedemptions.reduce((sum, r) => sum + r.discount, 0);

  // Get active partners count
  const partnersSnapshot = await db.collection(COLLECTIONS.PARTNERS)
    .where('isActive', '==', true)
    .get();

  return {
    period,
    startDate: startDate.toISOString(),
    endDate: now.toISOString(),
    totalRedemptions: redemptions.length,
    confirmedRedemptions: confirmedRedemptions.length,
    totalPointsRedeemed,
    totalDiscountGiven,
    activePartners: partnersSnapshot.size,
    redemptionsByStatus: statsByStatus,
    averageDiscount: confirmedRedemptions.length > 0 
      ? Math.round((totalDiscountGiven / confirmedRedemptions.length) * 100) / 100 
      : 0
  };
}

/**
 * Get all redemptions (admin view with filters)
 */
async function getAllRedemptions({ limit, offset, status, partnerId, userId }) {
  const db = getFirestore();

  let query = db.collection(COLLECTIONS.REDEMPTIONS)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .offset(offset);

  if (status) {
    query = query.where('status', '==', status);
  }

  if (partnerId) {
    query = query.where('partnerId', '==', partnerId);
  }

  if (userId) {
    query = query.where('userId', '==', userId);
  }

  const snapshot = await query.get();

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

module.exports = {
  createPartner,
  updatePartner,
  deletePartner,
  getSystemAnalytics,
  getAllRedemptions
};
