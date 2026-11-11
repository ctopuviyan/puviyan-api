const KNOWN_ROLES = new Set(['puviyan_admin', 'org_admin', 'org_analyst', 'partner_admin', 'partner_staff', 'partner_user', 'sustainability_action_owner', 'sustainability_service_provider']);
const WRITE_ROLES = new Set(['puviyan_admin', 'org_admin', 'partner_admin', 'partner_staff', 'partner_user', 'sustainability_action_owner', 'sustainability_service_provider']);
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function contextFor(uid, user, collaborations = {}) {
  if (!user || (user.status && user.status !== 'active')) fail(403, 'Your partner access is not active. Contact your administrator.');
  const roles = [...new Set([...(Array.isArray(user.roles) ? user.roles : []), user.role].filter(r => typeof r === 'string'))];
  if (!roles.some(r => KNOWN_ROLES.has(r))) fail(403, 'No approved partner role. Request access through the partner portal.');
  const superAdmin = roles.includes('puviyan_admin');
  if (!superAdmin && !user.orgId) fail(403, 'Your partner account needs an organisation.');
  const scoped = !superAdmin && user.scope?.type === 'departments';
  const departmentIds = scoped && Array.isArray(user.scope.departmentIds) ? user.scope.departmentIds.filter(id => typeof id === 'string' && id.length > 0) : [];
  if (!superAdmin && user.scope?.type && !['org', 'departments'].includes(user.scope.type)) fail(403, 'Unsupported partner scope. Contact your administrator.');
  const collaborator = Object.keys(collaborations).length > 0;
  const providerCanWrite = (user.accountType === 'sustainability_service_provider' || roles.includes('sustainability_service_provider')) &&
    !roles.includes('org_analyst') && Object.values(collaborations).some(v => v === 'write');
  const canWrite = superAdmin || (!roles.includes('org_analyst') && roles.some(r => WRITE_ROLES.has(r)));
  return { uid, membershipVersion: user.membershipVersion || 1, orgId: user.orgId || null, roles, superAdmin, departmentScoped: scoped, departmentIds, canWrite, collaborations, collaborator, providerCanWrite };
}
function assertOrg(context, orgId) {
  if (typeof orgId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(orgId)) fail(400, 'Select a valid organisation.');
  if (!context.superAdmin && context.orgId !== orgId) fail(403, 'This organisation is outside your access.');
}
function assertProject(context, project, write = false) {
  if (!project) fail(404, 'Project not found.');
  if (context.superAdmin) return;
  const isOwnOrg = context.orgId === project.orgId;
  const collaboratorAccess = context.collaborations?.[project.orgId];
  if (!isOwnOrg && !collaboratorAccess) fail(403, 'This organisation is outside your access.');
  if (context.departmentScoped && !context.departmentIds.includes(project.departmentId)) fail(403, 'This project is outside your department access.');
  if (write && (!context.canWrite || (collaboratorAccess && (!context.providerCanWrite || collaboratorAccess !== 'write')))) fail(403, 'Your approved roles allow viewing only.');
}
function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${label} is required and must be at most ${max} characters.`);
  return value.trim();
}
function validDate(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(400, `${label} must be a valid date.`);
  return new Date(value).toISOString();
}
function projectBoundary(input) {
  if (input == null) return null; // Older project clients may still omit a boundary.
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Choose a valid project boundary on the map.');
  const center = input.center;
  if (!center || typeof center !== 'object' || Array.isArray(center)) fail(400, 'Choose a centre point for the project boundary.');
  const { latitude, longitude } = center;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    fail(400, 'Choose a valid centre point for the project boundary.');
  }
  const radiusMeters = input.radiusMeters;
  if (!Number.isInteger(radiusMeters) || radiusMeters < 50 || radiusMeters > 10000) {
    fail(400, 'Project boundary radius must be between 50 and 10,000 metres.');
  }
  return { center: { latitude, longitude }, radiusMeters };
}
function assertProjectBoundary(project, point) {
  const boundary = project?.boundary;
  if (!boundary) return; // Preserve existing projects created before boundary support.
  const latitude = boundary.center?.latitude, longitude = boundary.center?.longitude, radiusMeters = boundary.radiusMeters;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) || typeof radiusMeters !== 'number' || !Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    fail(409, 'This project has an invalid boundary. Ask an organisation owner to update it.');
  }
  const radians = Math.PI / 180, earthRadiusMeters = 6371008.8;
  const lat1 = latitude * radians, lat2 = point.latitude * radians;
  const dLat = (point.latitude - latitude) * radians, dLon = (point.longitude - longitude) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const boundedA = Math.min(1, Math.max(0, a));
  const distanceMeters = 2 * earthRadiusMeters * Math.atan2(Math.sqrt(boundedA), Math.sqrt(1 - boundedA));
  if (distanceMeters > radiusMeters) {
    fail(400, 'This planting location is outside the project boundary. Choose a point inside the mapped radius.');
  }
}
function treeMetadata(input, now = Date.now()) {
  if (!input || typeof input !== 'object') fail(400, 'Tree details are required.');
  if (!/^[a-f0-9]{32}$/.test(input.recordId || '')) fail(400, 'A valid record ID is required.');
  for (const [key, min, max] of [['latitude', -90, 90], ['longitude', -180, 180], ['accuracyMeters', 0, 100]]) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < min || input[key] > max) fail(400, `Invalid ${key}. Refresh phone location.`);
  }
  if (!['camera', 'gallery'].includes(input.photoSource)) fail(400, 'Photo source is required.');
  const capturedAt = validDate(input.capturedAt, 'Photo capture time');
  const locationCapturedAt = validDate(input.locationCapturedAt, 'Location time');
  for (const date of [capturedAt, locationCapturedAt]) {
    if (Date.parse(date) > now + 5 * 60 * 1000 || Date.parse(date) < now - 24 * 60 * 60 * 1000) fail(400, 'Photo and location must have been recorded in the last 24 hours.');
  }
  if (input.eventId != null && (typeof input.eventId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.eventId))) fail(400, 'Invalid event.');
  if (input.notes != null && (typeof input.notes !== 'string' || input.notes.length > 1000)) fail(400, 'Notes must be at most 1000 characters.');
  return { recordId: input.recordId, species: text(input.species, 'Species', 100),
    notes: input.notes?.trim() || '', eventId: input.eventId || null,
    latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters,
    capturedAt, locationCapturedAt, photoSource: input.photoSource };
}
function imageType(buffer) {
  if (!Buffer.isBuffer(buffer)) fail(400, 'A JPEG or PNG photo is required.');
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  fail(400, 'Use a JPEG or PNG photo.');
}
module.exports = { fail, contextFor, assertOrg, assertProject, text, validDate, projectBoundary, assertProjectBoundary, treeMetadata, imageType };
