const { getFirestore, Timestamp } = require('../config/firebase.config');
const { ERROR_CODES, HTTP_STATUS } = require('../config/constants');
const { ApiError } = require('../middleware/error.middleware');
const { parse } = require('csv-parse/sync');

/**
 * Parse CSV data and validate employee records
 */
function parseEmployeeCSV(csvContent) {
  try {
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      cast: false,
    });

    return records;
  } catch (error) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_INVALID_VALUE, `CSV parsing failed: ${error.message}`);
  }
}

/**
 * Normalize and validate employee row
 */
function normalizeEmployeeRow(row) {
  const email = (row.email || '').trim().toLowerCase();
  
  if (!email || !email.includes('@')) {
    return null; // Skip invalid emails
  }

  const statusInOrg = (row.statusInOrg || row.status || 'active').toLowerCase();
  const validStatuses = ['active', 'inactive', 'left'];
  
  return {
    email,
    statusInOrg: validStatuses.includes(statusInOrg) ? statusInOrg : 'active',
    firstName: (row.firstName || row.first_name || '').trim(),
    lastName: (row.lastName || row.last_name || '').trim(),
    role: (row.role || '').trim(),
  };
}

/**
 * Begin a new epoch for organization employee updates
 */
async function beginEpoch(orgId, orgName) {
  const db = getFirestore();
  const orgRef = db.collection('organizations').doc(orgId);
  const orgDoc = await orgRef.get();

  let currentEpoch = 0;
  
  if (orgDoc.exists) {
    const orgData = orgDoc.data();
    currentEpoch = (orgData.currentEpoch || 0) + 1;
  } else {
    currentEpoch = 1;
  }

  const now = Timestamp.now();
  
  await orgRef.set(
    {
      currentEpoch,
      updatedAt: now,
      ...(orgName && { name: orgName }),
    },
    { merge: true }
  );

  return currentEpoch;
}

/**
 * Finalize epoch - mark employees not in latest as inactive
 */
async function finalizeEpoch(orgId, epochNumber) {
  const db = getFirestore();
  const employeesRef = db.collection('organizations').doc(orgId).collection('employees');

  // Find employees not present in this epoch
  const staleEmployees = await employeesRef
    .where('lastSeenEpoch', '<', epochNumber)
    .where('statusInOrg', '==', 'active')
    .get();

  const batch = db.batch();
  const now = Timestamp.now();

  staleEmployees.forEach((doc) => {
    batch.update(doc.ref, {
      presentInLatest: false,
      statusInOrg: 'inactive',
      updatedAt: now,
    });
  });

  // Update organization lastFinalizedEpoch
  const orgRef = db.collection('organizations').doc(orgId);
  batch.update(orgRef, {
    lastFinalizedEpoch: epochNumber,
    updatedAt: now,
  });

  await batch.commit();
}

/**
 * Upload CSV and bulk onboard employees
 */
async function uploadEmployeeCSV({ partnerUid, orgId, csvContent }) {
  const db = getFirestore();

  // Verify partner has access to this org
  const partnerUserDoc = await db.collection('partnerUsers').doc(partnerUid).get();
  if (!partnerUserDoc.exists) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'User is not a partner');
  }

  const partnerUser = partnerUserDoc.data();
  const isPuviyanAdmin = partnerUser.roles && partnerUser.roles.includes('puviyan_admin');
  
  // puviyan_admin can access any org, others must match their orgId
  if (!isPuviyanAdmin && partnerUser.orgId !== orgId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'Access denied to this organization');
  }

  // Verify organization exists
  const orgDoc = await db.collection('organizations').doc(orgId).get();
  if (!orgDoc.exists) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, ERROR_CODES.USR_INVALID_ORG, 'Organization not found');
  }

  const orgData = orgDoc.data();
  const orgName = orgData.name;

  // Parse CSV
  const rows = parseEmployeeCSV(csvContent);
  
  if (!rows || rows.length === 0) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VAL_INVALID_VALUE, 'CSV file is empty or invalid');
  }

  // Begin new epoch
  const epochNumber = await beginEpoch(orgId, orgName);
  
  const employeesCollection = db.collection('organizations').doc(orgId).collection('employees');
  
  let processed = 0;
  let skipped = 0;
  const errors = [];

  for (const row of rows) {
    const normalized = normalizeEmployeeRow(row);
    
    if (!normalized) {
      skipped++;
      errors.push(`Invalid email: ${row.email || 'missing'}`);
      continue;
    }

    const { email, statusInOrg, firstName, lastName, role } = normalized;
    
    try {
      // Check if employee already exists (query by email)
      const existingQuery = await employeesCollection
        .where('email', '==', email)
        .limit(1)
        .get();

      const employeeData = {
        email,
        statusInOrg,
        presentInLatest: true,
        lastSeenEpoch: epochNumber,
        updatedAt: Timestamp.now(),
        source: 'partner:csv',
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(role && { role }),
      };

      if (!existingQuery.empty) {
        // Update existing employee
        const docRef = existingQuery.docs[0].ref;
        await docRef.set(employeeData, { merge: true });
      } else {
        // Create new employee with auto-generated ID
        const docRef = employeesCollection.doc();
        await docRef.set(employeeData);
      }

      processed++;
    } catch (error) {
      skipped++;
      errors.push(`Failed to process ${email}: ${error.message}`);
    }
  }

  // Finalize the epoch
  await finalizeEpoch(orgId, epochNumber);

  return {
    success: true,
    processed,
    skipped,
    total: rows.length,
    epochNumber,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Get employees for an organization
 */
async function getEmployees({ partnerUid, orgId, limit = 100, offset = 0 }) {
  const db = getFirestore();

  // Verify partner has access to this org
  const partnerUserDoc = await db.collection('partnerUsers').doc(partnerUid).get();
  if (!partnerUserDoc.exists) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'User is not a partner');
  }

  const partnerUser = partnerUserDoc.data();
  const isPuviyanAdmin = partnerUser.roles && partnerUser.roles.includes('puviyan_admin');
  
  // puviyan_admin can access any org, others must match their orgId
  if (!isPuviyanAdmin && partnerUser.orgId !== orgId) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN, 'Access denied to this organization');
  }

  const employeesRef = db.collection('organizations').doc(orgId).collection('employees');
  
  const snapshot = await employeesRef
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .offset(offset)
    .get();

  const employees = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  // Get counts by status
  const activeSnapshot = await employeesRef.where('statusInOrg', '==', 'active').count().get();
  const inactiveSnapshot = await employeesRef.where('statusInOrg', '==', 'inactive').count().get();
  const leftSnapshot = await employeesRef.where('statusInOrg', '==', 'left').count().get();

  return {
    employees,
    pagination: {
      limit,
      offset,
      total: snapshot.size,
    },
    stats: {
      active: activeSnapshot.data().count,
      inactive: inactiveSnapshot.data().count,
      left: leftSnapshot.data().count,
      total: activeSnapshot.data().count + inactiveSnapshot.data().count + leftSnapshot.data().count,
    },
  };
}

module.exports = {
  uploadEmployeeCSV,
  getEmployees,
  parseEmployeeCSV,
  normalizeEmployeeRow,
};
