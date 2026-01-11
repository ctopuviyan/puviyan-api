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

  const orgDoc = await db.collection('orgs').doc(orgId).get();
  const org = orgDoc.exists ? { id: orgDoc.id, ...orgDoc.data() } : { id: orgId };

  const scope = partnerUser.scope || { type: 'org' };

  let allowedDepartments = [];

  if (scope.type === 'departments' && Array.isArray(scope.departmentIds)) {
    const deptIds = scope.departmentIds.filter(Boolean);
    const deptDocs = await Promise.all(
      deptIds.map(async (departmentId) => {
        const d = await db.collection('orgs').doc(orgId).collection('departments').doc(departmentId).get();
        if (!d.exists) {
          return { id: departmentId, name: departmentId, status: 'unknown' };
        }
        return { id: d.id, ...d.data() };
      })
    );

    allowedDepartments = deptDocs;
  } else {
    // Org-wide: return all departments (cap to 200)
    const deptsSnap = await db.collection('orgs').doc(orgId).collection('departments').limit(200).get();
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
    ? db.collection('orgs').doc(requestedOrgId)
    : db.collection('orgs').doc();

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

  const orgRef = db.collection('orgs').doc(orgId);
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

  const orgRef = db.collection('orgs').doc(orgId);
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

module.exports = {
  getPartnerMe,
  createOrg,
  joinOrg,
  rotateOrgInviteCode,
};
