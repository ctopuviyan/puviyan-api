const WATER_BODY_TYPES = new Set(['Lake', 'Pond', 'Tank', 'Reservoir', 'Wetland']);
const AREA_FACTORS = { acres: 4046.8564224, hectares: 10000, 'sq m': 1 };
const OUTCOMES = new Set([
  'improved_water_quality',
  'increased_storage',
  'groundwater_recharge',
  'reduced_flooding',
  'biodiversity_habitat',
  'community_benefits',
]);
const ASSURANCE_ROLES = new Set([
  'Independent Auditor',
  'Environmental Consultant',
  'Impact Assessment Agency',
]);
const PARTNER_TYPES = new Set(['implementation', 'supporting', 'assurance', 'managed_service']);

function optionalText(value, label, max) {
  if (value == null || value === '') return null;
  return text(value, label, max);
}

function text(value, label, max) {
  if (typeof value !== 'string' || value.trim().length > max) {
    fail(400, `${label} must be at most ${max} characters.`);
  }
  return value.trim();
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function calendarDate(value, label, required) {
  if (value == null || value === '') {
    if (required) fail(400, `${label} is required.`);
    return null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(400, `${label} must be a valid calendar date.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(400, `${label} must be a valid calendar date.`);
  }
  return value;
}

async function selectedPartner(db, id, type, required) {
  if (id == null || id === '') {
    const labels = {
      implementation: 'an implementation partner',
      managed_service: 'a managed service partner',
      supporting: 'a supporting partner',
      assurance: 'an assurance partner',
    };
    if (required) fail(400, `Choose ${labels[type] || 'a project partner'}.`);
    return null;
  }
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    fail(400, 'Choose a valid project partner.');
  }
  const snapshot = await db.collection('partnerDirectory').doc(id).get();
  if (!snapshot.exists || (snapshot.data().status && snapshot.data().status !== 'active')) {
    fail(400, 'A selected project partner is no longer available.');
  }
  const partner = snapshot.data();
  const types = [partner.partnerType, ...(partner.partnerTypes || [])].filter(Boolean);
  if (!types.includes(type)) fail(400, `The selected partner is not a ${type} partner.`);
  let partnerOrgId = partner.orgId || partner.organizationId || null;
  if (!partnerOrgId && partner.name) {
    const matchingOrg = await db.collection('organizations').where('name', '==', partner.name).limit(1).get();
    partnerOrgId = matchingOrg.docs[0]?.id || null;
  }
  return {
    partnerId: id,
    name: partner.name || id,
    partnerOrgId,
    access: partner.access || (type === 'implementation' ? 'write' : 'read_only'),
    role: type,
  };
}

function pinFrom(input, required) {
  if (input == null) {
    if (required) fail(400, 'Choose and pin a project location.');
    return null;
  }
  const center = input.center;
  const latitude = center?.latitude, longitude = center?.longitude;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    fail(400, 'Choose a valid project location pin.');
  }
  return { latitude, longitude };
}

async function buildWaterBodyProject(body, { db, orgId, uid, now = () => new Date(), existing = null }) {
  const draft = body.action === 'draft';
  const name = optionalText(body.name, 'Project name', 100);
  if (!draft && !name) fail(400, 'Project name is required and must be at most 100 characters.');
  const locationName = optionalText(body.locationName, 'Location', 200);
  if (!draft && !locationName) fail(400, 'Location is required.');
  const waterBodyType = body.waterBodyType ?? existing?.waterBodyType ?? null;
  if (waterBodyType != null && !WATER_BODY_TYPES.has(waterBodyType)) {
    fail(400, 'Choose Lake, Pond, Tank, Reservoir or Wetland.');
  }
  if (!draft && !waterBodyType) fail(400, 'Choose a water body type.');

  const areaInput = body.totalArea ?? existing?.totalArea ?? null;
  let totalArea = null;
  if (areaInput != null) {
    const value = Number(areaInput.value);
    const unit = areaInput.unit;
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000 || !Object.hasOwn(AREA_FACTORS, unit)) {
      fail(400, 'Enter a valid positive area and choose acres, hectares or sq m.');
    }
    totalArea = { value, unit, squareMetres: value * AREA_FACTORS[unit] };
  }
  if (!draft && !totalArea) fail(400, 'Approximate total area is required.');

  const pinInput = body.boundary ?? (existing?.boundary ? existing.boundary : existing?.locationPin ? { center: existing.locationPin } : null);
  const pin = pinFrom(pinInput, !draft);
  let vertices;
  if (pinInput?.vertices != null) {
    if (!Array.isArray(pinInput.vertices) || pinInput.vertices.length < 3 || pinInput.vertices.length > 200) {
      fail(400, 'Draw a project boundary with 3 to 200 points.');
    }
    vertices = pinInput.vertices.map(point => {
      const latitude = point?.latitude, longitude = point?.longitude;
      if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
          typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        fail(400, 'The project boundary contains an invalid map coordinate.');
      }
      return { latitude, longitude };
    });
  }
  const radiusMeters = pin && totalArea ? Math.sqrt(totalArea.squareMetres / Math.PI) : null;
  const boundary = pin && radiusMeters != null
    ? { center: pin, radiusMeters: Math.max(1, Math.round(radiusMeters)), ...(vertices ? { vertices } : {}), label: vertices ? 'User-drawn project boundary' : 'Indicative boundary based on approximate area' }
    : null;

  const startDate = calendarDate(body.startDate ?? existing?.startDate, 'Project start date', !draft);
  const endDateValue = Object.prototype.hasOwnProperty.call(body, 'endDate') ? body.endDate : existing?.endDate;
  const endDate = calendarDate(endDateValue, 'Expected end date', false);
  if (startDate && endDate && endDate <= startDate) {
    fail(400, 'Expected end date must be after the project start date.');
  }

  const implementationId = body.implementationPartnerId ?? existing?.implementationPartnerId ?? null;
  const implementationPartner = await selectedPartner(db, implementationId, 'implementation', !draft);
  const managedServiceId = body.managedServicePartnerId ?? existing?.managedServicePartnerId ?? null;
  const managedServicePartner = await selectedPartner(db, managedServiceId, 'managed_service', !draft);
  const supportingIds = body.supportingPartnerIds ?? existing?.supportingPartnerIds ?? [];
  if (!Array.isArray(supportingIds)) fail(400, 'Supporting partners must be a list.');
  const supportingPartners = [];
  for (const id of [...new Set(supportingIds)]) {
    const partner = await selectedPartner(db, id, 'supporting', false);
    if (partner) supportingPartners.push(partner);
  }
  const assuranceInput = body.assurancePartners ?? existing?.assurancePartners ?? [];
  if (!Array.isArray(assuranceInput)) fail(400, 'Assurance partners must be a list.');
  const assurancePartners = [];
  for (const item of assuranceInput) {
    if (!item || typeof item !== 'object') fail(400, 'Choose a valid assurance partner and role.');
    if (item.partnerId && !ASSURANCE_ROLES.has(item.role)) fail(400, 'Choose an assurance partner role.');
    const partner = await selectedPartner(db, item.partnerId, 'assurance', false);
    if (partner) assurancePartners.push({ ...partner, partnerType: 'assurance', role: item.role });
  }

  const outcomes = body.outcomes ?? existing?.outcomes ?? [];
  if (!Array.isArray(outcomes) || outcomes.some((id) => !OUTCOMES.has(id))) {
    fail(400, 'Choose valid water body project outcomes.');
  }
  const uniqueOutcomes = [...new Set(outcomes)];
  if (!draft && uniqueOutcomes.length === 0) fail(400, 'Select at least one project outcome.');

  const isCsr = body.isCsr ?? existing?.isCsr ?? false;
  if (typeof isCsr !== 'boolean') fail(400, 'CSR selection must be Yes or No.');
  const csrFinancialYear = isCsr
    ? optionalText(body.csrFinancialYear ?? existing?.csrFinancialYear, 'CSR financial year', 9)
    : null;
  if (!draft && isCsr && !csrFinancialYear) fail(400, 'Choose the CSR financial year.');
  const rawBudget = Object.prototype.hasOwnProperty.call(body, 'csrBudget')
    ? body.csrBudget
    : existing?.csrBudget ?? null;
  let csrBudget = null;
  if (isCsr && rawBudget != null) {
    const amount = Number(typeof rawBudget === 'object' ? rawBudget.amount : rawBudget);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) {
      fail(400, 'Enter a valid CSR budget amount.');
    }
    csrBudget = { amount, currencyCode: 'INR' };
  }
  const description = text(body.description ?? existing?.description ?? '', 'Description', 2000);
  const status = existing?.status && existing.status !== 'draft'
    ? existing.status
    : draft
      ? 'draft'
      : body.action === 'update'
        ? (existing?.status || 'baseline_pending')
        : 'baseline_pending';
  const timestamp = now().toISOString();
  return {
    project: {
      ...(existing || {}),
      name,
      description,
      locationName,
      scope: 'water_body_rejuvenation',
      waterBodyType,
      totalArea,
      boundary,
      locationPin: pin,
      startDate,
      endDate,
      orgId,
      createdByUid: existing?.createdByUid || uid,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
      status,
      actionOwnerOrgId: orgId,
      actionOwnerOrgName: null,
      implementationPartnerId: implementationPartner?.partnerId || null,
      implementationPartnerName: implementationPartner?.name || null,
      managedServicePartnerId: managedServicePartner?.partnerId || null,
      managedServicePartnerName: managedServicePartner?.name || null,
      supportingPartnerIds: supportingPartners.map((p) => p.partnerId),
      supportingPartners,
      assurancePartners: assurancePartners.map(({ partnerOrgId, ...p }) => p),
      outcomes: uniqueOutcomes,
      isCsr,
      csrFinancialYear,
      csrBudget,
      departmentId: body.departmentId ?? existing?.departmentId ?? null,
    },
    notificationPartners: [implementationPartner, ...supportingPartners, ...assurancePartners].filter(Boolean),
  };
}

async function saveProjectRelations(ref, project, notificationPartners = []) {
  const batch = ref.firestore.batch();
  const outcomeRefs = await ref.collection('outcomes').get();
  const outcomeIds = new Set(project.outcomes || []);
  // Keep deselected outcome documents and their reading subcollections as history.
  for (const old of outcomeRefs.docs) {
    if (!outcomeIds.has(old.id)) batch.set(old.ref, { selected: false, updatedAt: project.updatedAt }, { merge: true });
  }
  for (const outcomeId of project.outcomes || []) {
    const outcomeRef = ref.collection('outcomes').doc(outcomeId);
    const previous = await outcomeRef.get();
    batch.set(outcomeRef, {
      projectId: ref.id,
      outcomeId,
      selected: true,
      target: previous.exists ? previous.data().target ?? null : null,
      targetUnit: previous.exists ? previous.data().targetUnit ?? null : null,
      updatedAt: project.updatedAt,
    }, { merge: true });
  }
  const partnerRefs = await ref.collection('partners').get();
  const relationIds = new Set(notificationPartners.map((partner) => `${partner.partnerType || partner.role || 'supporting'}_${partner.partnerId}`));
  for (const old of partnerRefs.docs) {
    if (!relationIds.has(old.id)) batch.delete(old.ref);
  }
  for (const partner of notificationPartners) {
    const partnerType = partner.partnerType || partner.role || 'supporting';
    const relationId = `${partnerType}_${partner.partnerId}`;
    batch.set(ref.collection('partners').doc(relationId), {
      projectId: ref.id,
      partnerId: partner.partnerId,
      partnerName: partner.name,
      partnerOrgId: partner.partnerOrgId || null,
      access: partner.access || (partnerType === 'implementation' ? 'write' : 'read_only'),
      partnerType,
      role: partner.role,
      updatedAt: project.updatedAt,
    }, { merge: true });
  }
  await batch.commit();
}

async function queuePartnerNotifications(db, projectId, project, partners) {
  const notifications = db.collection('partnerProjectNotifications');
  const batch = db.batch();
  for (const partner of partners) {
    const partnerType = partner.partnerType || partner.role;
    const isImplementation = partnerType === 'implementation';
    const ref = notifications.doc(`${projectId}_${partner.partnerId}_${partnerType}`);
    batch.set(ref, {
      projectId,
      projectName: project.name,
      ownerOrgId: project.orgId,
      partnerId: partner.partnerId,
      recipientOrgId: partner.partnerOrgId || null,
      partnerType,
      role: partner.role,
      title: isImplementation ? 'New project assigned – add baseline data' : `You've been added to ${project.name}`,
      message: isImplementation ? 'Add baseline data for this water body project.' : `You have been added as a ${partner.role} partner to ${project.name}.`,
      status: 'unread',
      createdAt: project.updatedAt,
    }, { merge: true });
  }
  if (partners.length) await batch.commit();
}

module.exports = {
  AREA_FACTORS,
  ASSURANCE_ROLES,
  OUTCOMES,
  PARTNER_TYPES,
  WATER_BODY_TYPES,
  buildWaterBodyProject,
  queuePartnerNotifications,
  saveProjectRelations,
  selectedPartner,
};
