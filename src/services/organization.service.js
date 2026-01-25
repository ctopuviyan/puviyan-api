const { getFirestore } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');

/**
 * Organization Service - CRUD operations for organizations
 */

/**
 * Get all organizations (admin only)
 */
async function getAllOrganizations() {
  const db = getFirestore();

  const snapshot = await db.collection('organizations').get();
  
  const organizations = await Promise.all(snapshot.docs.map(async (doc) => {
    const data = doc.data();
    
    // Get member count from consumer app users (informations collection)
    const membersSnapshot = await db.collection('informations')
      .where('orgMembership.orgId', '==', doc.id)
      .count()
      .get();
    
    return {
      id: doc.id,
      name: data.name,
      logoUrl: data.logoUrl || null,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      memberCount: membersSnapshot.data().count || 0
    };
  }));

  return {
    organizations: organizations.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  };
}

/**
 * Get organization by ID
 */
async function getOrganizationById(orgId) {
  const db = getFirestore();

  const orgDoc = await db.collection('organizations').doc(orgId).get();
  
  if (!orgDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.VALIDATION_ERROR, 'Organization not found');
  }

  const data = orgDoc.data();
  
  // Get member count from consumer app users (informations collection)
  const membersSnapshot = await db.collection('informations')
    .where('orgMembership.orgId', '==', orgId)
    .count()
    .get();

  return {
    id: orgDoc.id,
    name: data.name,
    logoUrl: data.logoUrl || null,
    createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
    memberCount: membersSnapshot.data().count || 0
  };
}

/**
 * Get current user's organization
 */
async function getMyOrganization(userId) {
  const db = getFirestore(); // Consumer Firestore for all data
  const { getPartnerAuth } = require('../config/firebase.config');
  const partnerAuth = getPartnerAuth();

  // First, try to get organization ID from user's custom claims in Partner Firebase Auth
  try {
    const userRecord = await partnerAuth.getUser(userId);
    const customClaims = userRecord.customClaims || {};
    
    // Check if user has orgId in custom claims
    if (customClaims.orgId) {
      return getOrganizationById(customClaims.orgId);
    }
  } catch (error) {
    console.error('Error fetching user from Partner Firebase Auth:', error);
  }

  // Try to get user's org membership from partner_users collection in Consumer Firestore
  const partnerUserDoc = await db.collection('partner_users').doc(userId).get();
  
  if (partnerUserDoc.exists) {
    const userData = partnerUserDoc.data();
    const orgId = userData.orgId;

    if (orgId) {
      return getOrganizationById(orgId);
    }
  }

  // If still no organization found, return helpful error
  throw new ApiError(
    HTTP_STATUS.NOT_FOUND, 
    ERROR_CODES.VALIDATION_ERROR, 
    'User is not associated with any organization. Please contact your administrator to set up organization membership.'
  );
}

/**
 * Update organization
 */
async function updateOrganization(orgId, updates, updatedBy) {
  const db = getFirestore();

  const orgDoc = await db.collection('organizations').doc(orgId).get();
  
  if (!orgDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.VALIDATION_ERROR, 'Organization not found');
  }

  // Don't allow changing certain fields
  const disallowedFields = ['createdAt', 'createdBy'];
  disallowedFields.forEach(field => delete updates[field]);

  const updateData = {
    ...updates,
    updatedAt: new Date(),
    updatedBy: updatedBy
  };

  await db.collection('organizations').doc(orgId).update(updateData);

  return {
    orgId,
    message: 'Organization updated successfully'
  };
}

/**
 * Create organization (used by admin onboarding)
 */
async function createOrganization(orgData, createdBy) {
  const db = getFirestore();

  // Validate required fields
  if (!orgData.name) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Organization name is required');
  }

  const orgId = orgData.orgId || db.collection('organizations').doc().id;

  const organization = {
    name: orgData.name,
    logoUrl: orgData.logoUrl || null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: createdBy
  };

  await db.collection('organizations').doc(orgId).set(organization);

  return {
    orgId,
    orgName: organization.name,
    message: 'Organization created successfully'
  };
}

module.exports = {
  getAllOrganizations,
  getOrganizationById,
  getMyOrganization,
  updateOrganization,
  createOrganization
};
