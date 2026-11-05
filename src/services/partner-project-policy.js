const KNOWN_ROLES = new Set(['puviyan_admin', 'org_admin', 'org_analyst', 'partner_admin', 'partner_staff', 'partner_user', 'sustainability_action_owner', 'sustainability_service_provider']);
const WRITE_ROLES = new Set(['puviyan_admin', 'org_admin', 'partner_admin', 'partner_staff', 'partner_user', 'sustainability_action_owner', 'sustainability_service_provider']);
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function contextFor(uid, user) {
  if (!user || (user.status && user.status !== 'active')) fail(403, 'Your partner access is not active. Contact your administrator.');
  const roles = [...new Set([...(Array.isArray(user.roles) ? user.roles : []), user.role].filter(r => typeof r === 'string'))];
  if (!roles.some(r => KNOWN_ROLES.has(r))) fail(403, 'No approved partner role. Request access through the partner portal.');
  const superAdmin = roles.includes('puviyan_admin');
  if (!superAdmin && !user.orgId) fail(403, 'Your partner account needs an organisation.');
  const scoped = !superAdmin && user.scope?.type === 'departments';
  const departmentIds = scoped && Array.isArray(user.scope.departmentIds) ? user.scope.departmentIds.filter(id => typeof id === 'string' && id.length > 0) : [];
  if (!superAdmin && user.scope?.type && !['org', 'departments'].includes(user.scope.type)) fail(403, 'Unsupported partner scope. Contact your administrator.');
  return { uid, membershipVersion: user.membershipVersion || 1, orgId: user.orgId || null, roles, superAdmin, departmentScoped: scoped, departmentIds, canWrite: roles.some(r => WRITE_ROLES.has(r)) };
}
function assertOrg(context, orgId) {
  if (typeof orgId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(orgId)) fail(400, 'Select a valid organisation.');
  if (!context.superAdmin && context.orgId !== orgId) fail(403, 'This organisation is outside your access.');
}
function assertProject(context, project, write = false) {
  if (!project) fail(404, 'Project not found.');
  assertOrg(context, project.orgId);
  if (context.departmentScoped && !context.departmentIds.includes(project.departmentId)) fail(403, 'This project is outside your department access.');
  if (write && !context.canWrite) fail(403, 'Your approved roles allow viewing only.');
}
function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${label} is required and must be at most ${max} characters.`);
  return value.trim();
}
function validDate(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(400, `${label} must be a valid date.`);
  return new Date(value).toISOString();
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
module.exports = { fail, contextFor, assertOrg, assertProject, text, validDate, treeMetadata, imageType };
