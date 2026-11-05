const { getFirestore, FieldValue } = require('../config/firebase.config');
const { ApiError } = require('../middleware/error.middleware');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');
const crypto = require('crypto');

/**
 * New Signup System Service
 * 
 * Roles:
 * - puviyan_admin: Super admin, manages all signup requests
 * - org_admin: Organization administrator, can invite users
 * - org_analyst: Organization user with limited access
 * 
 * Flow:
 * 1. User submits signup request form
 * 2. Puviyan Admin reviews and approves
 * 3. System generates signup link with role/org context
 * 4. User signs up via link
 * 5. Org Admins can invite more users
 */


async function sharedManagement(actorUid) {
  const { getPartnerAuth } = require('../config/firebase.config');
  const { createPartnerManagement } = require('./partner-management.service');
  const { contextFor } = require('./partner-project-policy');
  const db = getFirestore();
  const record = await db.collection('partnerUsers').doc(actorUid).get();
  return { service: createPartnerManagement({ db, auth: getPartnerAuth() }), actor: contextFor(actorUid, record.exists ? record.data() : null) };
}
function portalFailure(error) { error.statusCode = error.statusCode || error.status || 500; throw error; }

// Generate secure random token for signup links


// Hash token for storage
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Get public list of organizations (public endpoint)
 */
async function getPublicOrganizations() {
  const db = getFirestore();
  
  const snapshot = await db.collection('organizations')
    .orderBy('name')
    .get();
  
  const organizations = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    // Only include active organizations or those without a status field
    if (data.membershipVersion !== 2 && (!data.status || data.status === 'active')) {
      organizations.push({
        id: doc.id,
        name: data.name,
      });
    }
  });
  
  return organizations;
}

/**
 * Submit a signup request (public endpoint)
 */
async function submitSignupRequest({ email, name, organizationName, existingOrgId, reason, requestedRoles = [] }) {
  email = typeof email === 'string' ? email.trim().toLowerCase() : email;
  name = typeof name === 'string' ? name.trim() : name;
  const allowedRequests = ['org_admin','org_analyst','partner_admin','partner_staff','partner_user'];
  if (!Array.isArray(requestedRoles) || requestedRoles.some(r => !allowedRequests.includes(r))) {
    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, 'Choose supported partner roles');
  }
  const db = getFirestore();
  
  if (!email || !name || !organizationName) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Email, name, and organization name are required');
  }

  if (existingOrgId && (await db.collection('organizations').doc(existingOrgId).get()).data()?.membershipVersion === 2) {
    throw new ApiError(403, ERROR_CODES.AUTH_FORBIDDEN, 'An email invitation is required for this organisation.');
  }

  // Check if user already exists in the system
  const existingUsers = await db.collection('partnerUsers')
    .where('email', '==', email)
    .get();

  if (existingUsers.docs.some(doc => !!doc.data().orgId || [...(doc.data().roles || []), doc.data().role].includes('puviyan_admin'))) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'An account already exists for this email. Please sign in instead.');
  }

  // Check if there's already a pending or approved request
  const existingRequests = await db.collection('signupRequests')
    .where('email', '==', email)
    .where('status', 'in', ['pending', 'approved'])
    .get();

  if (!existingRequests.empty) {
    const request = existingRequests.docs[0].data();
    if (request.status === 'pending') {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'A pending signup request already exists for this email. Please wait for admin approval.');
    } else if (request.status === 'approved') {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Your signup request has been approved. Please check your email for the signup link.');
    }
  }

  // Create signup request
  const requestData = {
    email,
    name,
    organizationName,
    assignedOrgId: existingOrgId || null, // If user selected existing org, store it
    requestedRoles: [...new Set(requestedRoles)],
    reason: reason || '',
    status: 'pending', // pending, approved, rejected
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const requestRef = await db.collection('signupRequests').add(requestData);

  return {
    id: requestRef.id,
    ...requestData,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Get all signup requests (Puviyan Admin and Org Admin)
 * If orgId is provided, only returns requests for that organization
 */
async function getSignupRequests({ status, limit = 50, orgId = null }) {
  const db = getFirestore();
  
  let query = db.collection('signupRequests');
  
  if (status) {
    query = query.where('status', '==', status);
  }
  
  // Note: We can't use where clause for orgId filtering because Firestore
  // doesn't support querying for null values with ==
  // So we fetch all and filter in memory
  const snapshot = await query.limit(limit * 3).get();
  
  const requests = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    
    // Filter by organization if orgId is provided (for org_admin)
    // org_admin should only see requests where assignedOrgId matches their org
    if (orgId) {
      // Skip requests without assignedOrgId (new org requests)
      // Skip requests with different assignedOrgId
      if (!data.assignedOrgId || data.assignedOrgId !== orgId) {
        return;
      }
    }
    
    requests.push({
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate(),
      updatedAt: data.updatedAt?.toDate(),
    });
  });
  
  // Sort by createdAt in memory
  requests.sort((a, b) => {
    const timeA = a.createdAt?.getTime() || 0;
    const timeB = b.createdAt?.getTime() || 0;
    return timeB - timeA; // desc order
  });
  
  return requests.slice(0, limit);
}

/**
 * Approve signup request and generate signup link (Puviyan Admin only)
 */
async function approveSignupRequest({ requestId, orgId, role = 'org_admin', approvedBy }) {
  try {
    const { service, actor } = await sharedManagement(approvedBy);
    const result = await service.review(actor, requestId, { decision: 'approve', orgId, roles: [role], sendEmail: true });
    const request = await getFirestore().collection('signupRequests').doc(requestId).get();
    return { ...result, signupLinkId: request.data().signupLinkId || null, token: result.signupUrl ? new URL(result.signupUrl).searchParams.get('token') : null };
  } catch (error) { return portalFailure(error); }
}

/**
 * Reject signup request (Puviyan Admin only)
 */
async function rejectSignupRequest({ requestId, rejectedBy, reason }) {
  try { const { service, actor } = await sharedManagement(rejectedBy);
    return await service.review(actor, requestId, { decision: 'reject', reason: reason || 'Request not approved.', sendEmail: true });
  } catch (error) { return portalFailure(error); }
}

/**
 * Generate signup link for existing org (Org Admin only)
 */
async function generateSignupLink({ email, name, orgId, role, createdBy }) {
  try { const { service, actor } = await sharedManagement(createdBy);
    const result = await service.invite(actor, { email, name: name || email, orgId, roles: [role], sendEmail: true });
    return { ...result, signupLinkId: result.id, token: new URL(result.signupUrl).searchParams.get('token') };
  } catch (error) { return portalFailure(error); }
}

/**
 * Validate signup token and get link details
 */
async function validateSignupToken({ token }) {
  const db = getFirestore();
  
  const tokenHash = hashToken(token);
  
  const linksSnapshot = await db.collection('signupLinks')
    .where('tokenHash', '==', tokenHash)
    .limit(1)
    .get();

  if (linksSnapshot.empty) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND, 'Invalid or expired signup link');
  }

  const linkDoc = linksSnapshot.docs[0];
  const linkData = linkDoc.data();

  if (linkData.used || linkData.revoked) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'This signup link has already been used');
  }

  // Check expiration
  if (linkData.expiresAt) {
    const expirationDate = linkData.expiresAt.toDate ? linkData.expiresAt.toDate() : new Date(linkData.expiresAt);
    if (expirationDate < new Date()) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'This signup link has expired');
    }
  }

  return {
    id: linkDoc.id,
    email: linkData.email,
    name: linkData.name,
    orgId: linkData.orgId,
    orgName: linkData.orgName,
    role: linkData.role,
    roles: linkData.roles || [linkData.role],
    scope: linkData.scope || { type: 'org' },
  };
}

/**
 * Complete signup using token
 */
async function completeSignup({ token, uid, email }) {
  const { getPartnerAuth } = require('../config/firebase.config');
  const { createPartnerManagement } = require('./partner-management.service');
  return createPartnerManagement({ db: getFirestore(), auth: getPartnerAuth() }).complete({ uid, email }, token).catch(error => { error.statusCode = error.status || 500; throw error; });
}

/**
 * Create Puviyan Admin manually
 */
async function createPuviyanAdmin({ uid, email, name }) {
  const db = getFirestore();
  
  // Check if user already exists
  const existingUser = await db.collection('partnerUsers').doc(uid).get();
  if (existingUser.exists) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'User already exists');
  }

  const partnerUserData = {
    email,
    name: name || email,
    roles: ['puviyan_admin'],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await db.collection('partnerUsers').doc(uid).set(partnerUserData);

  return {
    success: true,
    user: {
      uid,
      ...partnerUserData,
    },
  };
}

/**
 * Get all organizations for Puviyan Admin (no filtering)
 */
async function getAllOrganizations({ limit = 100 }) {
  const db = getFirestore();
  
  const snapshot = await db.collection('organizations')
    .where('status', '==', 'active')
    .limit(limit)
    .get();
  
  const organizations = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    organizations.push({
      id: doc.id,
      name: data.name || doc.id,
      status: data.status,
      createdAt: data.createdAt?.toDate(),
    });
  });
  
  // Sort by name
  organizations.sort((a, b) => a.name.localeCompare(b.name));
  
  return organizations;
}

/**
 * Get all organizations (Puviyan Admin only)
 */
async function getAllOrganizations() {
  const db = getFirestore();
  
  const orgsSnapshot = await db.collection('organizations')
    .where('status', '==', 'active')
    .get();
  
  const organizations = [];
  orgsSnapshot.forEach(doc => {
    organizations.push({
      id: doc.id,
      name: doc.data().name,
      status: doc.data().status,
      createdAt: doc.data().createdAt?.toDate(),
    });
  });
  
  return organizations;
}

/**
 * Generate smart org ID: first 5 letters of org name + 4 digit unique ID
 */
function generateSmartOrgId(orgName) {
  // Get first 5 letters (alphanumeric only)
  const prefix = orgName
    .replace(/[^a-zA-Z0-9]/g, '') // Remove non-alphanumeric
    .substring(0, 5)
    .toUpperCase();
  
  // Generate 4 digit random number
  const suffix = Math.floor(1000 + Math.random() * 9000);
  
  return `${prefix}${suffix}`;
}

/**
 * Create new organization (Puviyan Admin only)
 */
async function createOrganization({ name, orgId, createdBy }) {
  const db = getFirestore();
  
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Organization name is required');
  }

  const orgData = {
    name: name.trim(),
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    createdBy,
  };

  let newOrgRef;
  let finalOrgId;
  
  if (orgId) {
    // Use provided orgId
    newOrgRef = db.collection('organizations').doc(orgId);
    const existingOrg = await newOrgRef.get();
    
    if (existingOrg.exists) {
      throw new ApiError(HTTP_STATUS.CONFLICT, ERROR_CODES.VALIDATION_ERROR, 'Organization ID already exists');
    }
    
    await newOrgRef.set(orgData);
    finalOrgId = orgId;
  } else {
    // Auto-generate smart orgId with pattern: first5Letters+4digitUniqueId
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
      finalOrgId = generateSmartOrgId(name.trim());
      newOrgRef = db.collection('organizations').doc(finalOrgId);
      const existingOrg = await newOrgRef.get();
      
      if (!existingOrg.exists) {
        await newOrgRef.set(orgData);
        break;
      }
      
      attempts++;
    }
    
    if (attempts >= maxAttempts) {
      throw new ApiError(HTTP_STATUS.INTERNAL_ERROR, ERROR_CODES.SYS_DATABASE_ERROR, 'Failed to generate unique organization ID');
    }
  }

  return {
    orgId: finalOrgId,
    orgName: name.trim(),
  };
}

/**
 * Get signup link by ID (Puviyan Admin only)
 */
async function getSignupLinkById(linkId) {
  const db = getFirestore();
  
  const linkDoc = await db.collection('signupLinks').doc(linkId).get();
  
  if (!linkDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND, 'Signup link not found');
  }
  
  const data = linkDoc.data();
  
  return {
    id: linkDoc.id,
    email: data.email,
    name: data.name,
    orgId: data.orgId,
    orgName: data.orgName,
    role: data.role,
    used: data.used,
    usedAt: data.usedAt?.toDate(),
    usedBy: data.usedBy,
    createdAt: data.createdAt?.toDate(),
    createdBy: data.createdBy,
  };
}

module.exports = {
  getPublicOrganizations,
  submitSignupRequest,
  getSignupRequests,
  approveSignupRequest,
  rejectSignupRequest,
  generateSignupLink,
  validateSignupToken,
  completeSignup,
  createPuviyanAdmin,
  getAllOrganizations,
  createOrganization,
  getSignupLinkById,
};
