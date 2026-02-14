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

function isValidUrl(value) {
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function validateEventData(data) {
  const errors = [];

  const name = (data?.basics?.event_name || '').trim();
  if (!name || name.length < 5 || name.length > 100) errors.push('Invalid event name');

  const mode = data?.basics?.mode;
  if (mode !== 'in_person' && mode !== 'online') errors.push('Invalid mode');

  if (!data?.basics?.event_type) errors.push('Event type required');

  if (mode === 'in_person') {
    const loc = data?.basics?.location;
    if (!loc?.venueName?.trim()) errors.push('Venue name required');
    if (!loc?.address?.trim()) errors.push('Address required');
    if (!loc?.city?.trim()) errors.push('City required');
    if (!loc?.pinCode?.trim()) errors.push('Pin code required');
  } else if (mode === 'online') {
    const link = (data?.basics?.online_link || '').trim();
    if (!link || link.length > 255 || !isValidUrl(link)) errors.push('Invalid online link');
  }

  const about = (data?.basics?.about || '').trim();
  if (!about || about.length < 20 || about.length > 2000) errors.push('Invalid about');

  const checkin = data?.basics?.checkin_method;
  if (checkin !== 'gps' && checkin !== 'qr') errors.push('Invalid check-in method');

  const start = data?.schedule?.start_datetime;
  const end = data?.schedule?.end_datetime;
  if (!start) errors.push('Start datetime required');
  if (!end) errors.push('End datetime required');
  if (start && end) {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) errors.push('Invalid datetime');
    else if (endMs <= startMs) errors.push('End must be after start');
  }

  if (data?.schedule?.is_recurring && !data?.schedule?.recurrence_type) {
    errors.push('Recurrence type required');
  }

  if (!data?.capacity_goals?.unlimited) {
    const spots = data?.capacity_goals?.spots;
    if (spots == null || Number(spots) <= 0 || Number(spots) > 1000000) errors.push('Invalid spots');
  }

  return errors;
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
      role: partnerUser.role, // Add single role field for easier checking
      scope,
      status: partnerUser.status || 'active',
    },
    role: partnerUser.role, // Add at top level too for convenience
    org,
    allowedDepartments,
  };
}

async function getPartnerOrgContext(partnerUid) {
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

  return {
    orgId,
    partnerUser,
  };
}

async function saveEventDraft({ partnerUid, draftId = null, data, partnerEmail = null }) {
  const db = getFirestore();

  const { orgId } = await getPartnerOrgContext(partnerUid);

  if (!data || typeof data !== 'object') {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_INVALID_VALUE, 'data is required');
  }

  const ref = draftId ? db.collection('eventDrafts').doc(draftId) : db.collection('eventDrafts').doc();
  const now = new Date();

  await ref.set(
    {
      orgId,
      status: 'draft',
      data,
      updatedAt: now,
      createdAt: now,
      updatedByUid: partnerUid,
      updatedByEmail: partnerEmail || null,
    },
    { merge: true }
  );

  return { draftId: ref.id };
}

async function listEventDrafts({ partnerUid, limit = 50 }) {
  const db = getFirestore();
  const { orgId } = await getPartnerOrgContext(partnerUid);

  const snap = await db
    .collection('eventDrafts')
    .where('orgId', '==', orgId)
    .where('updatedByUid', '==', partnerUid)
    .orderBy('updatedAt', 'desc')
    .limit(Math.min(Number(limit) || 50, 200))
    .get();

  const drafts = snap.docs.map((doc) => {
    const d = doc.data() || {};
    return {
      id: doc.id,
      status: d.status,
      updatedAt: d.updatedAt?.toDate?.()?.toISOString?.() ?? null,
      createdAt: d.createdAt?.toDate?.()?.toISOString?.() ?? null,
      eventName: d.data?.basics?.event_name ?? '',
      mode: d.data?.basics?.mode ?? '',
    };
  });

  return { drafts };
}

async function getEventDraft({ partnerUid, draftId }) {
  const db = getFirestore();
  const { orgId } = await getPartnerOrgContext(partnerUid);

  if (!draftId) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_MISSING_FIELD, 'draftId is required');
  }

  const doc = await db.collection('eventDrafts').doc(draftId).get();
  if (!doc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.USR_NOT_FOUND, 'Draft not found');
  }

  const d = doc.data() || {};
  if (d.orgId !== orgId || d.updatedByUid !== partnerUid) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'Forbidden');
  }

  return {
    id: doc.id,
    status: d.status,
    data: d.data,
    updatedAt: d.updatedAt?.toDate?.()?.toISOString?.() ?? null,
  };
}

async function publishEventDraft({ partnerUid, draftId, partnerEmail = null }) {
  const db = getFirestore();
  const { orgId } = await getPartnerOrgContext(partnerUid);

  if (!draftId) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_MISSING_FIELD, 'draftId is required');
  }

  const draftRef = db.collection('eventDrafts').doc(draftId);
  const draftDoc = await draftRef.get();
  if (!draftDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.USR_NOT_FOUND, 'Draft not found');
  }

  const draft = draftDoc.data() || {};
  if (draft.orgId !== orgId || draft.updatedByUid !== partnerUid) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'Forbidden');
  }

  const data = draft.data;
  const validationErrors = validateEventData(data);
  if (validationErrors.length > 0) {
    const err = new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_VALIDATION_ERROR, 'Validation failed');
    err.details = validationErrors;
    throw err;
  }

  const eventRef = db.collection('events').doc();
  const now = new Date();

  await db.runTransaction(async (tx) => {
    tx.set(eventRef, {
      orgId,
      status: 'published',
      data,
      createdAt: now,
      createdByUid: partnerUid,
      createdByEmail: partnerEmail || null,
      updatedAt: now,
    });

    tx.set(
      draftRef,
      {
        status: 'published',
        publishedAt: now,
        publishedEventId: eventRef.id,
        updatedAt: now,
      },
      { merge: true }
    );
  });

  return { eventId: eventRef.id };
}

async function listPartnerEvents({ partnerUid, status = null, limit = 50 }) {
  const db = getFirestore();
  const { orgId } = await getPartnerOrgContext(partnerUid);

  let query = db.collection('events').where('orgId', '==', orgId);
  if (status) {
    query = query.where('status', '==', status);
  }

  const snap = await query
    .orderBy('createdAt', 'desc')
    .limit(Math.min(Number(limit) || 50, 200))
    .get();

  const events = snap.docs.map((doc) => {
    const d = doc.data() || {};
    return {
      id: doc.id,
      status: d.status,
      createdAt: d.createdAt?.toDate?.()?.toISOString?.() ?? null,
      updatedAt: d.updatedAt?.toDate?.()?.toISOString?.() ?? null,
      eventName: d.data?.basics?.event_name ?? '',
      mode: d.data?.basics?.mode ?? '',
      eventType: d.data?.basics?.event_type ?? '',
      start: d.data?.schedule?.start_datetime ?? '',
      end: d.data?.schedule?.end_datetime ?? '',
    };
  });

  return { events };
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
  const db = getFirestore();
  
  // Get partner's org
  const partnerDoc = await db.collection('partnerUsers').doc(partnerUid).get();
  if (!partnerDoc.exists) {
    throw new Error('Partner not found');
  }

  const partnerData = partnerDoc.data();
  if (!partnerData.orgId) {
    throw new Error('Partner not linked to any organization');
  }

  // Check if partner has partner_admin role (can be in roles array or role field)
  const roles = partnerData.roles || [];
  const role = partnerData.role;
  const isAdmin = roles.includes('partner_admin') || role === 'partner_admin';
  
  if (!isAdmin) {
    throw new Error('Only partner admins can view pending requests');
  }

  const orgId = partnerData.orgId;

  console.log(`[getPendingOrgLinkRequests] Admin orgId: ${orgId}, Admin UID: ${partnerUid}`);

  // Get all partner users
  const allPartnersSnapshot = await db.collection('partnerUsers').get();
  
  console.log(`[getPendingOrgLinkRequests] Total partner users: ${allPartnersSnapshot.size}`);
  
  const pendingRequests = [];

  // Check each partner's orgLinkRequests subcollection
  for (const partnerDoc of allPartnersSnapshot.docs) {
    const requestsSnapshot = await db.collection('partnerUsers')
      .doc(partnerDoc.id)
      .collection('orgLinkRequests')
      .where('orgId', '==', orgId)
      .where('status', '==', 'pending')
      .get();

    if (requestsSnapshot.size > 0) {
      console.log(`[getPendingOrgLinkRequests] Found ${requestsSnapshot.size} requests from partner ${partnerDoc.id}`);
    }

    for (const requestDoc of requestsSnapshot.docs) {
      const requestData = requestDoc.data();
      const partnerData = partnerDoc.data();
      console.log(`[getPendingOrgLinkRequests] Request: ${requestDoc.id}, orgId: ${requestData.orgId}, status: ${requestData.status}`);
      pendingRequests.push({
        id: requestDoc.id,
        partnerUid: partnerDoc.id,
        partnerName: partnerData.name || partnerData.email || 'Unknown',
        partnerEmail: partnerData.email || 'Unknown',
        ...requestData,
      });
    }
  }

  console.log(`[getPendingOrgLinkRequests] Total pending requests found: ${pendingRequests.length}`);

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
  const db = getFirestore();
  
  // Verify admin
  const adminDoc = await db.collection('partnerUsers').doc(adminUid).get();
  if (!adminDoc.exists) {
    throw new Error('Admin not found');
  }

  const adminData = adminDoc.data();
  const roles = adminData.roles || [];
  const role = adminData.role;
  const isAdmin = roles.includes('partner_admin') || role === 'partner_admin';
  
  if (!isAdmin) {
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
  const db = getFirestore();
  
  // Verify admin
  const adminDoc = await db.collection('partnerUsers').doc(adminUid).get();
  if (!adminDoc.exists) {
    throw new Error('Admin not found');
  }

  const adminData = adminDoc.data();
  const roles = adminData.roles || [];
  const role = adminData.role;
  const isAdmin = roles.includes('partner_admin') || role === 'partner_admin';
  
  if (!isAdmin) {
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

/**
 * Get dashboard metrics for partner
 * puviyan_admin: sees all organizations with per-org rewards/redemptions
 * org_admin: sees only their organization
 */
async function getDashboardMetrics(partnerUid) {
  const db = getFirestore();
  
  // Get partner's data
  const partnerDoc = await db.collection('partnerUsers').doc(partnerUid).get();
  if (!partnerDoc.exists) {
    throw new Error('Partner not found');
  }

  const partnerData = partnerDoc.data();
  const roles = partnerData.roles || [];
  const isPuviyanAdmin = roles.includes('puviyan_admin');
  
  if (isPuviyanAdmin) {
    // Puviyan admin sees all organizations
    const orgsSnapshot = await db.collection('organizations').get();
    const organizations = [];
    
    for (const orgDoc of orgsSnapshot.docs) {
      const orgId = orgDoc.id;
      const orgData = orgDoc.data();
      
      // Count employees from the employees subcollection
      const employeesSnapshot = await db.collection('organizations')
        .doc(orgId)
        .collection('employees')
        .where('statusInOrg', '==', 'active')
        .get();
      
      // Get rewards
      const rewardsSnapshot = await db.collection('rewards')
        .where('orgId', '==', orgId)
        .get();
      
      let activeRewards = 0;
      let inactiveRewards = 0;
      rewardsSnapshot.forEach(doc => {
        if (doc.data().status === 'active') activeRewards++;
        else inactiveRewards++;
      });
      
      // Get redemptions
      const redemptionsSnapshot = await db.collection('redemptions')
        .where('orgId', '==', orgId)
        .get();
      
      let reservedCount = 0;
      let redeemedCount = 0;
      redemptionsSnapshot.forEach(doc => {
        const status = doc.data().status;
        if (status === 'reserved') reservedCount++;
        else if (status === 'redeemed') redeemedCount++;
      });
      
      organizations.push({
        id: orgId,
        name: orgData?.name || 'Unknown',
        employeeCount: employeesSnapshot.size,
        rewards: {
          total: rewardsSnapshot.size,
          active: activeRewards,
          inactive: inactiveRewards,
        },
        redemptions: {
          total: redemptionsSnapshot.size,
          reserved: reservedCount,
          redeemed: redeemedCount,
        },
      });
    }
    
    // Get public rewards (orgId = null)
    const publicRewardsSnapshot = await db.collection('rewards')
      .where('orgId', '==', null)
      .get();
    
    let publicActiveRewards = 0;
    let publicInactiveRewards = 0;
    publicRewardsSnapshot.forEach(doc => {
      if (doc.data().status === 'active') publicActiveRewards++;
      else publicInactiveRewards++;
    });
    
    return { 
      organizations,
      publicRewards: {
        total: publicRewardsSnapshot.size,
        active: publicActiveRewards,
        inactive: publicInactiveRewards,
      }
    };
  }
  
  // Org admin or regular user - show only their organization
  const orgId = partnerData.orgId;

  if (!orgId) {
    return {
      organizations: [],
      rewards: { total: 0, active: 0, inactive: 0 },
      redemptions: { total: 0, reserved: 0, redeemed: 0 },
    };
  }

  // Get organization details
  const orgDoc = await db.collection('organizations').doc(orgId).get();
  const orgData = orgDoc.exists ? orgDoc.data() : null;

  // Count employees from the employees subcollection
  const employeesSnapshot = await db.collection('organizations')
    .doc(orgId)
    .collection('employees')
    .where('statusInOrg', '==', 'active')
    .get();
  const employeeCount = employeesSnapshot.size;

  // Get rewards for this organization
  const rewardsSnapshot = await db.collection('rewards')
    .where('orgId', '==', orgId)
    .get();
  
  let activeRewards = 0;
  let inactiveRewards = 0;
  
  rewardsSnapshot.forEach(doc => {
    const reward = doc.data();
    if (reward.status === 'active') {
      activeRewards++;
    } else {
      inactiveRewards++;
    }
  });

  // Get redemptions for this organization
  const redemptionsSnapshot = await db.collection('redemptions')
    .where('orgId', '==', orgId)
    .get();
  
  let reservedCount = 0;
  let redeemedCount = 0;
  
  redemptionsSnapshot.forEach(doc => {
    const redemption = doc.data();
    if (redemption.status === 'reserved') {
      reservedCount++;
    } else if (redemption.status === 'redeemed') {
      redeemedCount++;
    }
  });

  // Get public rewards (orgId = null) for org_admin users
  const publicRewardsSnapshot = await db.collection('rewards')
    .where('orgId', '==', null)
    .get();
  
  let publicActiveRewards = 0;
  let publicInactiveRewards = 0;
  publicRewardsSnapshot.forEach(doc => {
    if (doc.data().status === 'active') publicActiveRewards++;
    else publicInactiveRewards++;
  });

  return {
    organizations: [
      {
        id: orgId,
        name: orgData?.name || 'Unknown',
        employeeCount,
      }
    ],
    rewards: {
      total: rewardsSnapshot.size,
      active: activeRewards,
      inactive: inactiveRewards,
    },
    redemptions: {
      total: redemptionsSnapshot.size,
      reserved: reservedCount,
      redeemed: redeemedCount,
    },
    publicRewards: {
      total: publicRewardsSnapshot.size,
      active: publicActiveRewards,
      inactive: publicInactiveRewards,
    }
  };
}

/**
 * Get users for a specific organization
 */
async function getOrgUsers(partnerUid, orgId) {
  const db = getFirestore();
  
  // Verify partner has access to this org
  const partnerDoc = await db.collection('partnerUsers').doc(partnerUid).get();
  if (!partnerDoc.exists) {
    throw new Error('Partner not found');
  }

  const partnerData = partnerDoc.data();
  if (partnerData.orgId !== orgId) {
    throw new Error('Access denied: You do not have access to this organization');
  }

  // Get all users in this organization
  const usersSnapshot = await db.collection('users')
    .where('orgId', '==', orgId)
    .get();

  const users = [];
  usersSnapshot.forEach(doc => {
    const userData = doc.data();
    users.push({
      uid: doc.id,
      email: userData.email || 'Unknown',
      name: userData.name || userData.displayName || null,
      role: userData.role || null,
      roles: userData.roles || [],
    });
  });

  return {
    users,
    total: users.length,
  };
}

module.exports = {
  getPartnerMe,
  saveEventDraft,
  listEventDrafts,
  getEventDraft,
  publishEventDraft,
  listPartnerEvents,
  createOrg,
  joinOrg,
  rotateOrgInviteCode,
  listAvailableOrganizations,
  requestOrgLink,
  getOrgLinkRequests,
  getPendingOrgLinkRequests,
  approveOrgLinkRequest,
  rejectOrgLinkRequest,
  getDashboardMetrics,
  getOrgUsers,
};
