const { getFirestore, FieldValue } = require('../config/firebase.config');
const { ApiError } = require('../middleware/error.middleware');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');
const crypto = require('crypto');
const emailService = require('./email.service');

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

// Generate secure random token for signup links
function generateSignupToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Hash token for storage
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Submit a signup request (public endpoint)
 */
async function submitSignupRequest({ email, name, organizationName, reason }) {
  const db = getFirestore();
  
  if (!email || !name || !organizationName) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Email, name, and organization name are required');
  }

  // Check if user already exists in the system
  const existingUsers = await db.collection('partnerUsers')
    .where('email', '==', email)
    .get();

  if (!existingUsers.empty) {
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
 * Get all signup requests (Puviyan Admin only)
 */
async function getSignupRequests({ status, limit = 50 }) {
  const db = getFirestore();
  
  let query = db.collection('signupRequests');
  
  if (status) {
    query = query.where('status', '==', status);
  }
  
  // Note: If using status filter with orderBy, you need a composite index
  // For now, we'll fetch all and sort in memory to avoid index requirement
  const snapshot = await query.limit(limit * 2).get();
  
  const requests = [];
  snapshot.forEach(doc => {
    const data = doc.data();
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
  const db = getFirestore();
  
  if (!['org_admin', 'org_analyst'].includes(role)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Invalid role. Must be org_admin or org_analyst');
  }

  // Get the request
  const requestDoc = await db.collection('signupRequests').doc(requestId).get();
  
  if (!requestDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND, 'Signup request not found');
  }

  const request = requestDoc.data();
  
  if (request.status !== 'pending') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Request has already been processed');
  }

  // Verify organization exists
  const orgDoc = await db.collection('organizations').doc(orgId).get();
  if (!orgDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND, 'Organization not found');
  }

  // Generate signup token
  const token = generateSignupToken();
  const tokenHash = hashToken(token);

  // Create signup link record
  const signupLinkData = {
    email: request.email,
    name: request.name,
    orgId,
    orgName: orgDoc.data().name,
    role,
    tokenHash,
    used: false,
    createdBy: approvedBy,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: FieldValue.serverTimestamp(), // TODO: Add expiration logic
  };

  const linkRef = await db.collection('signupLinks').add(signupLinkData);

  const signupUrl = `${process.env.PARTNER_PORTAL_URL || 'http://localhost:3000'}/signup?token=${token}`;

  // Update request status
  await db.collection('signupRequests').doc(requestId).update({
    status: 'approved',
    approvedBy,
    approvedAt: FieldValue.serverTimestamp(),
    signupLinkId: linkRef.id,
    signupUrl, // Store the URL for easy retrieval
    assignedOrgId: orgId,
    assignedOrgName: orgDoc.data().name,
    assignedRole: role,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Send signup link email
  const emailResult = await emailService.sendSignupLinkEmail({
    to: request.email,
    name: request.name,
    signupUrl,
    orgName: orgDoc.data().name,
  });

  return {
    signupLinkId: linkRef.id,
    token,
    signupUrl,
    emailSent: emailResult.success,
    emailError: emailResult.error,
  };
}

/**
 * Reject signup request (Puviyan Admin only)
 */
async function rejectSignupRequest({ requestId, rejectedBy, reason }) {
  const db = getFirestore();
  
  const requestDoc = await db.collection('signupRequests').doc(requestId).get();
  
  if (!requestDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND, 'Signup request not found');
  }

  const request = requestDoc.data();
  
  if (request.status !== 'pending') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Request has already been processed');
  }

  await db.collection('signupRequests').doc(requestId).update({
    status: 'rejected',
    rejectedBy,
    rejectedAt: FieldValue.serverTimestamp(),
    rejectionReason: reason || '',
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Send rejection email
  const emailResult = await emailService.sendRejectionEmail({
    to: request.email,
    name: request.name,
    reason: reason || '',
  });

  return { 
    success: true,
    emailSent: emailResult.success,
    emailError: emailResult.error,
  };
}

/**
 * Generate signup link for existing org (Org Admin only)
 */
async function generateSignupLink({ email, name, orgId, role, createdBy }) {
  const db = getFirestore();
  
  if (!['org_admin', 'org_analyst'].includes(role)) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Invalid role. Must be org_admin or org_analyst');
  }

  // Verify organization exists
  const orgDoc = await db.collection('organizations').doc(orgId).get();
  if (!orgDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND, 'Organization not found');
  }

  // Check if user already exists
  const existingUser = await db.collection('partnerUsers')
    .where('email', '==', email)
    .where('orgId', '==', orgId)
    .get();

  if (!existingUser.empty) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'User already exists in this organization');
  }

  // Generate signup token
  const token = generateSignupToken();
  const tokenHash = hashToken(token);

  // Create signup link record with 7-day expiration
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + 7); // 7 days from now
  
  const signupLinkData = {
    email,
    name: name || '',
    orgId,
    orgName: orgDoc.data().name,
    role,
    tokenHash,
    used: false,
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: expirationDate,
  };

  const linkRef = await db.collection('signupLinks').add(signupLinkData);

  const signupUrl = `${process.env.PARTNER_PORTAL_URL || 'http://localhost:3000'}/signup?token=${token}`;

  // Send signup link email
  const emailResult = await emailService.sendSignupLinkEmail({
    to: email,
    name: name || email,
    signupUrl,
    orgName: orgDoc.data().name,
  });

  return {
    signupLinkId: linkRef.id,
    token,
    signupUrl,
    emailSent: emailResult.success,
    emailError: emailResult.error,
  };
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

  if (linkData.used) {
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
  };
}

/**
 * Complete signup using token
 */
async function completeSignup({ token, uid, email }) {
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

  if (linkData.used) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'This signup link has already been used');
  }

  if (linkData.email.toLowerCase() !== email.toLowerCase()) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Email does not match signup link');
  }

  // Create partner user
  const partnerUserData = {
    email: linkData.email,
    name: linkData.name,
    orgId: linkData.orgId,
    roles: [linkData.role],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await db.collection('partnerUsers').doc(uid).set(partnerUserData);

  // Mark link as used
  await db.collection('signupLinks').doc(linkDoc.id).update({
    used: true,
    usedAt: FieldValue.serverTimestamp(),
    usedBy: uid,
  });

  return {
    success: true,
    user: {
      uid,
      ...partnerUserData,
    },
  };
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
  submitSignupRequest,
  getSignupRequests,
  approveSignupRequest,
  rejectSignupRequest,
  generateSignupLink,
  validateSignupToken,
  completeSignup,
  createPuviyanAdmin,
  getAllOrganizations,
  getSignupLinkById,
};
