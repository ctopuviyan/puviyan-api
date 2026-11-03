const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const { fail, contextFor, assertOrg, assertProject, text, validDate, treeMetadata, imageType } = require('../services/partner-project-policy');

const { getFirestore, getPartnerAuth } = require('../config/firebase.config');
const { apiLimiter } = require('../middleware/rateLimit.middleware');
const { getPartnerTreeBucket } = require('../services/partner-tree-storage.service');
const { createPartnerManagement } = require('../services/partner-management.service');

// Reuse the shared API's initialized Firebase apps; dependencies remain injectable for tests.
function createPartnerAppRouter({ db = getFirestore(), auth = getPartnerAuth(),
  getBucket = getPartnerTreeBucket, logger = console, managementOptions = {} } = {}) {
  const router = express.Router();
  router.use(apiLimiter);
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const projects = db.collection('partnerProjects');
  const management = createPartnerManagement({ db, auth, ...managementOptions });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1, fieldSize: 16 * 1024 } });
  router.use(async (req, _res, next) => {
    try {
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
      if (!token) fail(401, 'Please sign in to continue.');
      let decoded;
      try { decoded = await auth.verifyIdToken(token, true); }
      catch (_) { fail(401, 'Your session has expired. Please sign in again.'); }
      req.identity = { uid: decoded.uid, email: decoded.email || '' };
      next();
    } catch (error) { next(error); }
  });
  // Authenticated account routes also serve invited users who are not onboarded yet.
  router.get('/account', wrap(async (req,res) => res.json(await management.account(req.identity))));
  router.patch('/account', wrap(async (req,res) => res.json(await management.profile(req.identity,req.body))));
  router.get('/account/requests', wrap(async (req,res) => res.json(await management.ownRequests(req.identity))));
  router.post('/account/complete-signup', wrap(async (req,res) => res.json(await management.complete(req.identity,req.body.token))));
  router.use(async (req,_res,next) => {
    try { const user = await db.collection('partnerUsers').doc(req.identity.uid).get();
      req.context = contextFor(req.identity.uid,user.exists ? user.data() : null); next();
    } catch(error) { next(error); }
  });
  router.post('/account/role-requests', wrap(async (req,res) => res.status(201).json(await management.requestRoles(req.context,req.identity,req.body))));
  router.get('/management/organisations', wrap(async (req,res) => res.json(await management.organisations(req.context))));
  router.post('/management/organisations', wrap(async (req,res) => res.status(201).json(await management.saveOrganisation(req.context,null,req.body))));
  router.patch('/management/organisations/:orgId', wrap(async (req,res) => res.json(await management.saveOrganisation(req.context,req.params.orgId,req.body))));
  router.get('/management/users', wrap(async (req,res) => res.json(await management.listUsers(req.context,req.query.orgId))));
  router.patch('/management/users/:uid', wrap(async (req,res) => res.json(await management.updateUser(req.context,req.params.uid,req.body))));
  router.get('/management/invitations', wrap(async (req,res) => res.json(await management.listInvites(req.context,req.query.orgId))));
  router.post('/management/invitations', wrap(async (req,res) => res.status(201).json(await management.invite(req.context,req.body))));
  router.post('/management/invitations/:id', wrap(async (req,res) => res.json(await management.changeInvite(req.context,req.params.id,req.body))));
  router.get('/management/requests', wrap(async (req,res) => res.json(await management.listRequests(req.context,req.query.status))));
  router.post('/management/requests/:id/review', wrap(async (req,res) => res.json(await management.review(req.context,req.params.id,req.body))));
  function projectRef(id) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id || '')) fail(400, 'Invalid project ID.');
    return projects.doc(id);
  }
  async function loadProject(req, write = false) {
    const ref = projectRef(req.params.id);
    const snapshot = await ref.get();
    const project = snapshot.exists ? snapshot.data() : null;
    assertProject(req.context, project, write);
    return { ref, project };
  }
  const serialise = snapshot => ({ id: snapshot.id, ...snapshot.data() });
  const sortLatest = list => list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  router.get('/me', wrap(async (req, res) => {
    const c = req.context;
    let orgName = 'All organisations';
    const departments = [];
    if (c.orgId) {
      const org = await db.collection('organizations').doc(c.orgId).get();
      orgName = org.data()?.name || c.orgId;
      if (c.departmentScoped) {
        for (const id of c.departmentIds) {
          const department = await db.collection('organizations').doc(c.orgId).collection('departments').doc(id).get();
          departments.push({ id, name: department.data()?.name || id });
        }
      }
    }
    res.json({ uid: c.uid, orgId: c.orgId, orgName, roles: c.roles,
      departmentScoped: c.departmentScoped, departments, canWrite: c.canWrite });
  }));
  router.get('/organisations', wrap(async (req, res) => {
    if (!req.context.superAdmin) fail(403, 'Super admin access is required.');
    const snapshot = await db.collection('organizations').limit(500).get();
    res.json({ organisations: snapshot.docs.map(d => ({ id: d.id, name: d.data().name || d.id })) });
  }));
  router.get('/projects', wrap(async (req, res) => {
    const c = req.context;
    const orgId = req.query.orgId || c.orgId;
    if (orgId) assertOrg(c, orgId);
    if (!orgId && !c.superAdmin) fail(403, 'An organisation is required.');
    let query = orgId ? projects.where('orgId', '==', orgId) : projects;
    const snapshot = await query.limit(500).get();
    const visible = snapshot.docs.map(serialise).filter(p => !c.departmentScoped || c.departmentIds.includes(p.departmentId));
    res.json({ projects: sortLatest(visible) });
  }));
  router.post('/projects', wrap(async (req, res) => {
    const c = req.context;
    if (!c.canWrite) fail(403, 'Your approved roles allow viewing only.');
    const orgId = req.body.orgId || c.orgId;
    assertOrg(c, orgId);
    const org = await db.collection('organizations').doc(orgId).get();
    if (!org.exists || (org.data().status && org.data().status !== 'active')) fail(400, 'Choose an active organisation.');
    const departmentId = req.body.departmentId || null;
    if (c.departmentScoped && !c.departmentIds.includes(departmentId)) fail(403, 'Select one of your assigned departments.');
    if (departmentId) {
      if (typeof departmentId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(departmentId)) fail(400, 'Invalid department.');
      const department = await db.collection('organizations').doc(orgId).collection('departments').doc(departmentId).get();
      if (!department.exists) fail(400, 'Department not found.');
    }
    if (!['plant_trees', 'prevent_soil_erosion'].includes(req.body.scope)) fail(400, 'Choose a supported project scope.');
    const project = {
      name: text(req.body.name, 'Project name', 100), description: text(req.body.description, 'Description', 2000),
      locationName: text(req.body.locationName, 'Location', 200), scope: req.body.scope,
      orgId, departmentId, createdByUid: c.uid, createdAt: new Date().toISOString(), status: 'active',
    };
    const ref = await projects.add(project);
    res.status(201).json({ project: { id: ref.id, ...project } });
  }));
  router.get('/projects/:id', wrap(async (req, res) => {
    const { ref, project } = await loadProject(req);
    const [events, trees] = await Promise.all([ref.collection('events').limit(500).get(), ref.collection('trees').limit(500).get()]);
    const records = await Promise.all(trees.docs.map(async doc => {
      const { storagePath, fingerprint, ...record } = doc.data();
      // Only authenticated, scoped reads mint short-lived URLs; the bucket stays private.
      const [photoUrl] = await getBucket().file(storagePath).getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1000 });
      return { id: doc.id, ...record, photoUrl };
    }));
    res.json({ project: { id: ref.id, ...project }, events: sortLatest(events.docs.map(serialise)), trees: sortLatest(records) });
  }));
  router.post('/projects/:id/events', wrap(async (req, res) => {
    const { ref, project } = await loadProject(req, true);
    const startsAt = validDate(req.body.startsAt, 'Start time');
    const endsAt = validDate(req.body.endsAt, 'End time');
    if (Date.parse(endsAt) <= Date.parse(startsAt)) fail(400, 'End time must be after start time.');
    const event = { name: text(req.body.name, 'Event name', 100), locationName: text(req.body.locationName, 'Venue', 200),
      startsAt, endsAt, orgId: project.orgId, projectId: ref.id, createdByUid: req.context.uid, createdAt: new Date().toISOString() };
    const eventRef = await ref.collection('events').add(event);
    res.status(201).json({ event: { id: eventRef.id, ...event } });
  }));
  // Check access before accepting a potentially large upload into memory.
  router.post('/projects/:id/trees', async (req, res, next) => {
    try { req.loadedProject = await loadProject(req, true); next(); } catch (error) { next(error); }
  }, upload.single('photo'), wrap(async (req, res) => {
    const { ref, project } = req.loadedProject;
    if (project.scope !== 'plant_trees') fail(400, 'Tree records belong to Plant Trees projects.');
    if (!req.file) fail(400, 'A tree photo is required.');
    const contentType = imageType(req.file.buffer);
    let raw;
    try { raw = JSON.parse(req.body.metadata); } catch (_) { fail(400, 'Invalid tree details.'); }
    const data = treeMetadata(raw);
    if (data.eventId) {
      const event = await ref.collection('events').doc(data.eventId).get();
      if (!event.exists) fail(400, 'The selected event does not belong to this project.');
    }
    const treeRef = ref.collection('trees').doc(data.recordId);
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(data)).update(req.file.buffer).digest('hex');
    const existing = await treeRef.get();
    if (existing.exists) {
      if (existing.data().createdByUid !== req.context.uid || existing.data().fingerprint !== fingerprint) fail(409, 'This record ID already has different details.');
      return res.json({ id: treeRef.id, saved: true });
    }
    // Each attempt gets a unique object; only the transaction winner remains after a concurrent retry.
    const storagePath = `partner-projects/${project.orgId}/${ref.id}/${data.recordId}/${crypto.randomUUID()}`;
    const file = getBucket().file(storagePath);
    await file.save(req.file.buffer, { resumable: false, contentType, metadata: { cacheControl: 'private, max-age=0' } });
    let committed = false;
    try {
      committed = await db.runTransaction(async tx => {
        const current = await tx.get(treeRef);
        if (current.exists) {
          if (current.data().createdByUid !== req.context.uid || current.data().fingerprint !== fingerprint) fail(409, 'This record ID already has different details.');
          return false;
        }
        tx.create(treeRef, { ...data, projectId: ref.id, orgId: project.orgId, departmentId: project.departmentId || null,
          storagePath, fingerprint, createdByUid: req.context.uid, createdAt: new Date().toISOString(), verificationStatus: 'submitted' });
        return true;
      });
    } catch (error) {
      // If the commit acknowledgement was lost, confirm before deleting its image.
      try { const check = await treeRef.get(); committed = check.exists && check.data().storagePath === storagePath; }
      catch (_) { logger.error('Tree upload needs orphan reconciliation', { storagePath }); throw error; }
      if (!committed) await file.delete({ ignoreNotFound: true }).catch(() => logger.error('Orphan photo', { storagePath }));
      throw error;
    }
    if (!committed) await file.delete({ ignoreNotFound: true }).catch(() => logger.error('Orphan photo', { storagePath }));
    res.status(committed ? 201 : 200).json({ id: treeRef.id, saved: true });
  }));
  // Limit this error mapping to the new namespace; keep legacy route behaviour intact.
  router.use((error, _req, res, _next) => {
    const status = error instanceof multer.MulterError ? 400 : error.status || 500;
    if (status >= 500) logger.error(error);
    res.status(status).json({ message: error instanceof multer.MulterError ? 'Use one photo smaller than 8 MB.' : status >= 500 ? 'The service is unavailable. Please retry.' : error.message });
  });
  return router;
}
module.exports = { createPartnerAppRouter };
