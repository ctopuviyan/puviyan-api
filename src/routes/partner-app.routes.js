const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const { fail, contextFor, assertOrg, assertProject, text, validDate, treeMetadata, imageType } = require('../services/partner-project-policy');

const { getFirestore, getPartnerAuth } = require('../config/firebase.config');
const { apiLimiter } = require('../middleware/rateLimit.middleware');
const { getPartnerTreeBucket } = require('../services/partner-tree-storage.service');
const { createPartnerManagement } = require('../services/partner-management.service');
const { createSustainabilityRouter } = require('./sustainability-accounts.routes');
const { requirePasswordIdentity } = require('../services/sustainability-accounts.service');
const { createPlantingMonitoring } = require('../services/planting-monitoring.service');
const { createPlantingPhotoAssessor } = require('../services/planting-photo-assessment.service');
const { spatialCells, distance } = require('../services/planting-monitoring-policy');
const { geohashForLocation } = require('geofire-common');

// Reuse the shared API's initialized Firebase apps; dependencies remain injectable for tests.
function createPartnerAppRouter({ db = getFirestore(), auth = getPartnerAuth(),
  getBucket = getPartnerTreeBucket, logger = console, managementOptions = {}, sustainabilityOptions = {}, monitoringOptions = {} } = {}) {
  const router = express.Router();
  router.use(apiLimiter);
  router.use('/v2', createSustainabilityRouter({db,auth,options:sustainabilityOptions}));
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const projects = db.collection('partnerProjects');
  const management = createPartnerManagement({ db, auth, ...managementOptions });
  const assess = monitoringOptions.assess || createPlantingPhotoAssessor({ db });
  const monitoring = createPlantingMonitoring({ db, getBucket, logger, ...monitoringOptions, assess });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1, fieldSize: 16 * 1024 } });
  router.use(async (req, _res, next) => {
    try {
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
      if (!token) fail(401, 'Please sign in to continue.');
      let decoded;
      try { decoded = await auth.verifyIdToken(token, true); }
      catch (_) { fail(401, 'Your session has expired. Please sign in again.'); }
      req.identity = { uid: decoded.uid, email: decoded.email || '', signInProvider: decoded.firebase?.sign_in_provider };
      const membership = await db.collection('partnerUsers').doc(decoded.uid).get();
      if (membership.data()?.membershipVersion === 2) {
        await requirePasswordIdentity(auth,req.identity);
        const org = await db.collection('organizations').doc(membership.data().orgId).get();
        if (!org.exists || org.data().status !== 'active') fail(403,'The organisation is inactive.');
        if (!/^\/(projects(?:\/|$)|me$|account$)/.test(req.path) || (req.path === '/account' && req.method !== 'GET')) fail(403,'Use the sustainability v2 account and member APIs.');
        if (req.method === 'POST' && /\/trees$/.test(req.path)) fail(410,'Update the app to submit planting evidence with a capture session.');
      }
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
    res.json({ uid: c.uid, membershipVersion: c.membershipVersion, orgId: c.orgId, orgName, roles: c.roles,
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
      const { storagePath, contextStoragePath, fingerprint, imageHashes, perceptualHash, contextPerceptualHash, captureSessionId, ...record } = doc.data();
      // Only authenticated, scoped reads mint short-lived URLs; the bucket stays private.
      const [photoUrl] = await getBucket().file(storagePath).getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1000 });
      const result = { id: doc.id, ...record, photoUrl };
      if (contextStoragePath) [result.contextPhotoUrl] = await getBucket().file(contextStoragePath).getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1000 });
      return result;
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
        const cell = spatialCells(data);
        const neighbours = await Promise.all(cell.keys.map(key => tx.get(db.collection('partnerPlantingCells').doc(key))));
        const nearby = neighbours.flatMap(doc => doc.data()?.points || []);
        if (nearby.some(point => distance(data, point) <= 5)) fail(409, 'A planting is already registered within five metres. Open the existing record and add a growth observation.');
        const centre = neighbours.find(doc => doc.id === cell.centre)?.data()?.points || [];
        if (centre.length >= 200) fail(409, 'This location needs index reconciliation before another registration.');
        const createdAt = new Date().toISOString();
        const point = { projectId: ref.id, treeId: treeRef.id, orgId: project.orgId, latitude: data.latitude, longitude: data.longitude, accuracyMeters: data.accuracyMeters };
        tx.create(treeRef, { ...data, projectId: ref.id, orgId: project.orgId, departmentId: project.departmentId || null,
          storagePath, fingerprint, createdByUid: req.context.uid, createdAt, verificationStatus: 'submitted' });
        tx.set(db.collection('partnerPlantingCells').doc(cell.centre), { points: [...centre, point], updatedAt: createdAt });
        tx.create(db.collection('partnerPlantingLocations').doc(`${ref.id}_${treeRef.id}`), { ...point, geohash: geohashForLocation([data.latitude, data.longitude]), createdAt });
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
  // Planting records and repeat growth observations. New v2 requests require
  // an app-issued capture session; the original tree endpoint remains compatible.
  const plantingUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 2, fields: 1, fieldSize: 24 * 1024 } });
  const parsePlanting = req => { try { return JSON.parse(req.body.metadata); } catch (_) { fail(400, 'Invalid planting details.'); } };
  router.post('/projects/:id/plantings/captures', wrap(async (req,res) => res.status(201).json(await monitoring.beginCapture(req.context,req.params.id,req.body))));
  router.post('/projects/:id/plantings', plantingUpload.fields([{name:'photo',maxCount:1},{name:'contextPhoto',maxCount:1}]), wrap(async (req,res) => {
    const photos=req.files||{}; if(!photos.photo?.[0]) fail(400,'A close-up planting photo is required.');
    const result=await monitoring.baseline(req.context,req.params.id,parsePlanting(req),photos.photo[0].buffer,photos.contextPhoto?.[0]?.buffer);
    res.status(result.created?201:200).json(result);
  }));
  router.get('/projects/:id/plantings/nearby', wrap(async (req,res) => res.json(await monitoring.nearby(req.context,req.params.id,req.query))));
  router.get('/projects/:id/plantings/remote-imagery', wrap(async (req,res) => res.json(await monitoring.remoteList(req.context,req.params.id))));
  router.post('/projects/:id/plantings/remote-imagery', plantingUpload.single('photo'), wrap(async (req,res) => {
    if(!req.file) fail(400,'An imagery preview is required.');
    const result=await monitoring.remote(req.context,req.params.id,parsePlanting(req),req.file.buffer);res.status(result.created?201:200).json(result);
  }));
  router.get('/projects/:id/plantings/:plantingId', wrap(async (req,res) => res.json(await monitoring.detail(req.context,req.params.id,req.params.plantingId))));
  router.post('/projects/:id/plantings/:plantingId/observations', plantingUpload.fields([{name:'photo',maxCount:1},{name:'contextPhoto',maxCount:1}]), wrap(async (req,res) => {
    const photos=req.files||{}; if(!photos.photo?.[0]) fail(400,'A growth photo is required.');
    const result=await monitoring.observe(req.context,req.params.id,req.params.plantingId,parsePlanting(req),photos.photo[0].buffer,photos.contextPhoto?.[0]?.buffer);
    res.status(result.created?201:200).json(result);
  }));
  router.post('/projects/:id/plantings/:plantingId/observations/:observationId/review', wrap(async (req,res) => res.json(await monitoring.review(req.context,req.params.id,req.params.plantingId,req.params.observationId,req.body))));
  router.patch('/projects/:id/plantings/:plantingId/schedule', wrap(async (req,res) => res.json(await monitoring.schedule(req.context,req.params.id,req.params.plantingId,req.body))));
  // Limit this error mapping to the new namespace; keep legacy route behaviour intact.
  router.use((error, _req, res, _next) => {
    const status = error instanceof multer.MulterError ? 400 : error.status || 500;
    if (status >= 500) logger.error(error);
    res.status(status).json({ message: error instanceof multer.MulterError ? 'Use one photo smaller than 8 MB.' : status >= 500 ? 'The service is unavailable. Please retry.' : error.message });
  });
  return router;
}
module.exports = { createPartnerAppRouter };
