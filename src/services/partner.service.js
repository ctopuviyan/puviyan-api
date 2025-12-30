const { getFirestore } = require('../config/firebase.config');
const { COLLECTIONS, ERROR_CODES, HTTP_STATUS, REDEMPTION_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');

/**
 * Get all active partners
 */
async function getAllPartners({ category, city }) {
  const db = getFirestore();

  let query = db.collection(COLLECTIONS.PARTNERS)
    .where('isActive', '==', true);

  if (category) {
    query = query.where('category', '==', category);
  }

  if (city) {
    query = query.where('location.city', '==', city);
  }

  const snapshot = await query.get();

  const partners = snapshot.docs.map(doc => ({
    id: doc.id,
    name: doc.data().name,
    logo: doc.data().logo,
    category: doc.data().category,
    location: doc.data().location,
    redemptionRate: doc.data().redemptionRate,
    offers: doc.data().offers || []
  }));

  return { partners, total: partners.length };
}

/**
 * Get partner details
 */
async function getPartnerDetails(partnerId) {
  const db = getFirestore();

  const partnerDoc = await db.collection(COLLECTIONS.PARTNERS).doc(partnerId).get();

  if (!partnerDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.INVALID_PARTNER, 'Partner not found');
  }

  const partner = partnerDoc.data();

  return {
    id: partnerDoc.id,
    ...partner,
    createdAt: partner.createdAt?.toDate?.()?.toISOString()
  };
}

/**
 * Get partner's redemption history
 */
async function getPartnerRedemptions({ partnerId, limit, offset, startDate, endDate }) {
  const db = getFirestore();

  let query = db.collection(COLLECTIONS.REDEMPTIONS)
    .where('partnerId', '==', partnerId)
    .where('status', '==', REDEMPTION_STATUS.CONFIRMED)
    .orderBy('confirmedAt', 'desc')
    .limit(limit)
    .offset(offset);

  if (startDate) {
    query = query.where('confirmedAt', '>=', new Date(startDate));
  }

  if (endDate) {
    query = query.where('confirmedAt', '<=', new Date(endDate));
  }

  const snapshot = await query.get();

  const redemptions = snapshot.docs.map(doc => ({
    id: doc.id,
    points: doc.data().points,
    discount: doc.data().discount,
    confirmedAt: doc.data().confirmedAt?.toDate?.()?.toISOString(),
    partnerTransactionId: doc.data().partnerTransactionId
  }));

  return {
    redemptions,
    total: snapshot.size,
    limit,
    offset
  };
}

/**
 * Get partner analytics
 */
async function getPartnerAnalytics({ partnerId, period }) {
  const db = getFirestore();

  // Calculate date range based on period
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

  // Get confirmed redemptions in period
  const snapshot = await db.collection(COLLECTIONS.REDEMPTIONS)
    .where('partnerId', '==', partnerId)
    .where('status', '==', REDEMPTION_STATUS.CONFIRMED)
    .where('confirmedAt', '>=', startDate)
    .get();

  const redemptions = snapshot.docs.map(doc => doc.data());

  // Calculate analytics
  const totalRedemptions = redemptions.length;
  const totalPointsRedeemed = redemptions.reduce((sum, r) => sum + r.points, 0);
  const totalDiscountGiven = redemptions.reduce((sum, r) => sum + r.discount, 0);
  const averageDiscount = totalRedemptions > 0 ? totalDiscountGiven / totalRedemptions : 0;

  return {
    period,
    startDate: startDate.toISOString(),
    endDate: now.toISOString(),
    totalRedemptions,
    totalPointsRedeemed,
    totalDiscountGiven,
    averageDiscount: Math.round(averageDiscount * 100) / 100
  };
}

module.exports = {
  getAllPartners,
  getPartnerDetails,
  getPartnerRedemptions,
  getPartnerAnalytics
};
