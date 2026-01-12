const { getFirestore } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');
const crypto = require('crypto');

function getInviteCodeSecret() {
  return (
    process.env.ORG_INVITE_CODE_SALT ||
    process.env.PARTNER_API_KEY_SALT ||
    process.env.JWT_SECRET ||
    'org-invite-default-secret'
  );
}

function hashInviteCode(inviteCode) {
  return crypto.createHmac('sha256', getInviteCodeSecret()).update(inviteCode).digest('hex');
}

function generateInviteCode() {
  // 8 chars base36 (not easily guessable in practice when hashed + rate limited)
  return crypto.randomBytes(6).toString('base64url').slice(0, 8);
}

async function getPartnerMe({ partnerUid }) {
  const db = getFirestore();

  const partnerUserDoc = await db.collection('partnerUsers').doc(partnerUid).get();
  if (!partnerUserDoc.exists) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'User is not onboarded as a partner user');
  }

  const partnerUser = partnerUserDoc.data();
  const orgId = partnerUser.orgId;

  if (!orgId) {
    throw new ApiError(HTTP_STATUS.INTERNAL_ERROR, ERROR_CODES.SYS_DATABASE_ERROR, 'partnerUsers record missing orgId');
  }

  const orgDoc = await db.collection('organizations').doc(orgId).get();
  const org = orgDoc.exists ? { id: orgDoc.id, ...orgDoc.data() } : { id: orgId };

  const scope = partnerUser.scope || { type: 'org' };

  let allowedDepartments = [];

  if (scope.type === 'departments' && Array.isArray(scope.departmentIds)) {
    const deptIds = scope.departmentIds.filter(Boolean);
    const deptDocs = await Promise.all(
      deptIds.map(async (departmentId) => {
        const d = await db.collection('organizations').doc(orgId).collection('departments').doc(departmentId).get();
        if (!d.exists) {
          return { id: departmentId, name: departmentId, status: 'unknown' };
        }
        return { id: d.id, ...d.data() };
      })
    );

    allowedDepartments = deptDocs;
  } else {
    // Org-wide: return all departments (cap to 200)
    const deptsSnap = await db.collection('organizations').doc(orgId).collection('departments').limit(200).get();
    allowedDepartments = deptsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  return {
    partnerUser: {
      uid: partnerUid,
      orgId,
      roles: partnerUser.roles || [],
      scope,
      status: partnerUser.status || 'active',
    },
    org,
    allowedDepartments,
  };
}

async function createOrg({ partnerUid, orgName, requestedOrgId = null }) {
  const db = getFirestore();

  if (!orgName || typeof orgName !== 'string' || !orgName.trim()) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_INVALID_VALUE, 'orgName is required');
  }

  const partnerUserRef = db.collection('partnerUsers').doc(partnerUid);
  const partnerUserDoc = await partnerUserRef.get();
  if (partnerUserDoc.exists) {
    const existing = partnerUserDoc.data();
    if (existing?.orgId) {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.VAL_DUPLICATE_ENTRY,
        'Partner user is already onboarded to an org'
      );
    }
  }

  const orgRef = requestedOrgId
    ? db.collection('organizations').doc(requestedOrgId)
    : db.collection('organizations').doc();

  if (requestedOrgId) {
    const existingOrg = await orgRef.get();
    if (existingOrg.exists) {
      throw new ApiError(HTTP_STATUS.CONFLICT, ERROR_CODES.VAL_DUPLICATE_ENTRY, 'orgId already exists');
    }
  }

  const now = new Date();
  const orgId = orgRef.id;

  const inviteCode = generateInviteCode();
  const inviteCodeHash = hashInviteCode(inviteCode);

  const batch = db.batch();

  batch.set(orgRef, {
    name: orgName.trim(),
    status: 'active',
    inviteCodeHash,
    createdAt: now,
    updatedAt: now,
    createdByPartnerUid: partnerUid,
    // OrgOnboarder compatibility fields
    currentEpoch: 0,
    lastFinalizedEpoch: 0,
    partnerManaged: true, // Flag to indicate this org is managed by partners
  });

  batch.set(
    partnerUserRef,
    {
      orgId,
      roles: ['partner_admin'],
      scope: { type: 'org' },
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  await batch.commit();

  return {
    orgId,
    inviteCode,
    org: {
      id: orgId,
      name: orgName.trim(),
      status: 'active',
    },
  };
}

async function joinOrg({ partnerUid, orgId, inviteCode }) {
  const db = getFirestore();

  if (!orgId || typeof orgId !== 'string') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_INVALID_VALUE, 'orgId is required');
  }
  if (!inviteCode || typeof inviteCode !== 'string') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_INVALID_VALUE, 'inviteCode is required');
  }

  const partnerUserRef = db.collection('partnerUsers').doc(partnerUid);
  const partnerUserDoc = await partnerUserRef.get();
  if (partnerUserDoc.exists) {
    const existing = partnerUserDoc.data();
    if (existing?.orgId) {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.VAL_DUPLICATE_ENTRY,
        'Partner user is already onboarded to an org'
      );
    }
  }

  const orgRef = db.collection('organizations').doc(orgId);
  const orgDoc = await orgRef.get();
  if (!orgDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.USR_INVALID_ORG, 'Organization not found');
  }

  const orgData = orgDoc.data() || {};
  if (!orgData.inviteCodeHash) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'Organization is not joinable');
  }

  const providedHash = hashInviteCode(inviteCode);
  if (providedHash !== orgData.inviteCodeHash) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'Invalid invite code');
  }

  const now = new Date();
  await partnerUserRef.set(
    {
      orgId,
      roles: ['partner_user'],
      scope: { type: 'org' },
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  return {
    orgId,
    org: {
      id: orgId,
      ...(orgData.name ? { name: orgData.name } : {}),
      ...(orgData.status ? { status: orgData.status } : {}),
    },
  };
}

async function rotateOrgInviteCode({ partnerUid, orgId }) {
  const db = getFirestore();

  if (!orgId || typeof orgId !== 'string') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_INVALID_VALUE, 'orgId is required');
  }

  const partnerUserDoc = await db.collection('partnerUsers').doc(partnerUid).get();
  if (!partnerUserDoc.exists) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'User is not onboarded as a partner user');
  }

  const partnerUser = partnerUserDoc.data() || {};
  if (partnerUser.orgId !== orgId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'Access denied to this org');
  }

  const roles = Array.isArray(partnerUser.roles) ? partnerUser.roles : [];
  if (!roles.includes('partner_admin')) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'Only org admins can rotate invite code');
  }

  const orgRef = db.collection('organizations').doc(orgId);
  const orgDoc = await orgRef.get();
  if (!orgDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.USR_INVALID_ORG, 'Organization not found');
  }

  const inviteCode = generateInviteCode();
  const inviteCodeHash = hashInviteCode(inviteCode);
  const now = new Date();

  await orgRef.set(
    {
      inviteCodeHash,
      updatedAt: now,
    },
    { merge: true }
  );

  return {
    orgId,
    inviteCode,
  };
}

/**
 * List available organizations for linking
 */
async function listAvailableOrganizations({ partnerUid, searchQuery = '', limit = 50 }) {
  const db = getFirestore();

  // Get partner's current org (if any)
  const partnerUserDoc = await db.collection('partnerUsers').doc(partnerUid).get();
  const currentOrgId = partnerUserDoc.exists ? partnerUserDoc.data()?.orgId : null;

  let query = db.collection('organizations')
    .where('status', '==', 'active')
    .limit(limit);

  // If search query provided, we'll filter in memory (Firestore doesn't support text search)
  const snapshot = await query.get();
  
  let organizations = snapshot.docs
    .filter(doc => doc.id !== currentOrgId) // Exclude current org
    .map(doc => ({
      id: doc.id,
      name: doc.data().name || doc.id,
      status: doc.data().status,
      partnerManaged: doc.data().partnerManaged || false,
      createdAt: doc.data().createdAt,
    }));

  // Filter by search query if provided
  if (searchQuery) {
    const lowerQuery = searchQuery.toLowerCase();
    organizations = organizations.filter(org => 
      org.name.toLowerCase().includes(lowerQuery) || 
      org.id.toLowerCase().includes(lowerQuery)
    );
  }

  return {
    organizations,
    total: organizations.length,
  };
}

/**
 * Request access to link to an organization
 */
async function requestOrgLink({ partnerUid, orgId, reason = '' }) {
  const db = getFirestore();

  // Verify partner user exists
  const partnerUserDoc = await db.collection('partnerUsers').doc(partnerUid).get();
  if (!partnerUserDoc.exists) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'User is not a partner');
  }

  const partnerUser = partnerUserDoc.data();
  const currentOrgId = partnerUser.orgId;

  if (!currentOrgId) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_INVALID_VALUE, 'Partner must be onboarded to an org first');
  }

  // Verify target organization exists
  const orgDoc = await db.collection('organizations').doc(orgId).get();
  if (!orgDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.USR_INVALID_ORG, 'Organization not found');
  }

  // Check if link request already exists
  const existingLinkQuery = await db.collection('partnerUsers')
    .doc(partnerUid)
    .collection('orgLinkRequests')
    .where('orgId', '==', orgId)
    .where('status', 'in', ['pending', 'approved'])
    .limit(1)
    .get();

  if (!existingLinkQuery.empty) {
    const existingStatus = existingLinkQuery.docs[0].data().status;
    throw new ApiError(
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.VAL_DUPLICATE_ENTRY,
      `Link request already exists with status: ${existingStatus}`
    );
  }

  // Create link request
  const now = new Date();
  const linkRequestRef = db.collection('partnerUsers')
    .doc(partnerUid)
    .collection('orgLinkRequests')
    .doc();

  await linkRequestRef.set({
    orgId,
    orgName: orgDoc.data().name || orgId,
    status: 'pending', // pending, approved, rejected
    reason: reason || '',
    requestedAt: now,
    requestedBy: partnerUid,
    updatedAt: now,
  });

  return {
    linkRequestId: linkRequestRef.id,
    orgId,
    status: 'pending',
    message: 'Organization link request submitted. Awaiting approval.',
  };
}

/**
 * Get partner's organization link requests
 */
async function getOrgLinkRequests({ partnerUid }) {
  const db = getFirestore();

  const snapshot = await db.collection('partnerUsers')
    .doc(partnerUid)
    .collection('orgLinkRequests')
    .orderBy('requestedAt', 'desc')
    .limit(50)
    .get();

  const requests = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  }));

  return {
    requests,
    total: requests.length,
  };
}

/**
 * Get all pending org link requests for the admin's organization
 * Only partner_admin can access this
 */
async function getPendingOrgLinkRequests(partnerUid) {
  // Get partner's org
  const partnerDoc = await db.collection('partnerUsers').doc(partnerUid).get();
  if (!partnerDoc.exists) {
    throw new Error('Partner not found');
  }

  const partnerData = partnerDoc.data();
  if (!partnerData.orgId) {
    throw new Error('Partner not linked to any organization');
  }

  if (partnerData.role !== 'partner_admin') {
    throw new Error('Only partner admins can view pending requests');
  }

  const orgId = partnerData.orgId;

  // Get all partner users
  const allPartnersSnapshot = await db.collection('partnerUsers').get();
  
  const pendingRequests = [];

  // Check each partner's orgLinkRequests subcollection
  for (const partnerDoc of allPartnersSnapshot.docs) {
    const requestsSnapshot = await db.collection('partnerUsers')
      .doc(partnerDoc.id)
      .collection('orgLinkRequests')
      .where('orgId', '==', orgId)
      .where('status', '==', 'pending')
      .get();

    for (const requestDoc of requestsSnapshot.docs) {
      pendingRequests.push({
        id: requestDoc.id,
        partnerUid: partnerDoc.id,
        partnerEmail: partnerDoc.data().email || 'Unknown',
        ...requestDoc.data(),
      });
    }
  }

  // Sort by requestedAt descending
  pendingRequests.sort((a, b) => {
    const aTime = a.requestedAt?.toMillis?.() || 0;
    const bTime = b.requestedAt?.toMillis?.() || 0;
    return bTime - aTime;
  });

  return {
    requests: pendingRequests,
    total: pendingRequests.length,
  };
}

/**
 * Approve an org link request and assign role to partner
 */
async function approveOrgLinkRequest(adminUid, partnerUid, requestId, assignedRole) {
  // Verify admin
  const adminDoc = await db.collection('partnerUsers').doc(adminUid).get();
  if (!adminDoc.exists) {
    throw new Error('Admin not found');
  }

  const adminData = adminDoc.data();
  if (adminData.role !== 'partner_admin') {
    throw new Error('Only partner admins can approve requests');
  }

  if (!adminData.orgId) {
    throw new Error('Admin not linked to any organization');
  }

  // Validate assigned role
  if (!['partner_admin', 'partner_staff'].includes(assignedRole)) {
    throw new Error('Invalid role. Must be partner_admin or partner_staff');
  }

  // Get the request
  const requestRef = db.collection('partnerUsers')
    .doc(partnerUid)
    .collection('orgLinkRequests')
    .doc(requestId);

  const requestDoc = await requestRef.get();
  if (!requestDoc.exists) {
    throw new Error('Request not found');
  }

  const requestData = requestDoc.data();

  // Verify the request is for admin's org
  if (requestData.orgId !== adminData.orgId) {
    throw new Error('Cannot approve request for different organization');
  }

  if (requestData.status !== 'pending') {
    throw new Error('Request is not pending');
  }

  // Update request status
  await requestRef.update({
    status: 'approved',
    approvedBy: adminUid,
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    assignedRole,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Update partner user with org and role
  await db.collection('partnerUsers').doc(partnerUid).update({
    orgId: requestData.orgId,
    role: assignedRole,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    message: 'Request approved successfully',
    partnerUid,
    orgId: requestData.orgId,
    role: assignedRole,
  };
}

/**
 * Reject an org link request
 */
async function rejectOrgLinkRequest(adminUid, partnerUid, requestId, rejectionReason) {
  // Verify admin
  const adminDoc = await db.collection('partnerUsers').doc(adminUid).get();
  if (!adminDoc.exists) {
    throw new Error('Admin not found');
  }

  const adminData = adminDoc.data();
  if (adminData.role !== 'partner_admin') {
    throw new Error('Only partner admins can reject requests');
  }

  if (!adminData.orgId) {
    throw new Error('Admin not linked to any organization');
  }

  // Get the request
  const requestRef = db.collection('partnerUsers')
    .doc(partnerUid)
    .collection('orgLinkRequests')
    .doc(requestId);

  const requestDoc = await requestRef.get();
  if (!requestDoc.exists) {
    throw new Error('Request not found');
  }

  const requestData = requestDoc.data();

  // Verify the request is for admin's org
  if (requestData.orgId !== adminData.orgId) {
    throw new Error('Cannot reject request for different organization');
  }

  if (requestData.status !== 'pending') {
    throw new Error('Request is not pending');
  }

  // Update request status
  await requestRef.update({
    status: 'rejected',
    rejectedBy: adminUid,
    rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
    rejectionReason: rejectionReason || 'No reason provided',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    message: 'Request rejected successfully',
  };
}

module.exports = {
  getPartnerMe,
  createOrg,
  joinOrg,
  rotateOrgInviteCode,
  listAvailableOrganizations,
  requestOrgLink,
  getOrgLinkRequests,
  getPendingOrgLinkRequests,
  approveOrgLinkRequest,
  rejectOrgLinkRequest,
};
