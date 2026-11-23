const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const { fail, contextFor, assertOrg, text, validDate, projectBoundary, assertProjectBoundary, treeMetadata, imageType } = require('../services/partner-project-policy');

const { getFirestore, getPartnerAuth } = require('../config/firebase.config');
const { apiLimiter } = require('../middleware/rateLimit.middleware');
const { getPartnerTreeBucket } = require('../services/partner-tree-storage.service');
const { createPartnerManagement } = require('../services/partner-management.service');
const { createSustainabilityRouter } = require('./sustainability-accounts.routes');
const { requirePasswordIdentity } = require('../services/sustainability-accounts.service');
const { createPlantingMonitoring } = require('../services/planting-monitoring.service');
const { createPlantingPhotoAssessor } = require('../services/planting-photo-assessment.service');
const { createProjectVegetation } = require('../services/project-vegetation.service');
const { createPiaTreeCarbonImpact, FACTORS } = require('../services/pia-tree-carbon-impact.service');
const { createInAppProjectNotifications } = require('../services/in-app-project-notifications.service');
const { ASSURANCE_ROLES, PARTNER_TYPES, buildWaterBodyProject, queuePartnerNotifications, saveProjectRelations, selectedPartner } = require('../services/water-body-project');
const waterOutcomeMasters = require('../services/water-body-outcomes');
const { geohashForLocation } = require('geofire-common');

// Reuse the shared API's initialized Firebase apps; dependencies remain injectable for tests.
function createPartnerAppRouter({ db = getFirestore(), auth = getPartnerAuth(),
  getBucket = getPartnerTreeBucket, logger = console, managementOptions = {}, sustainabilityOptions = {}, monitoringOptions = {}, vegetationOptions = {} } = {}) {
  const router = express.Router();
  router.use(apiLimiter);
  router.use('/v2', createSustainabilityRouter({db,auth,options:sustainabilityOptions}));
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const projects = db.collection('partnerProjects');
  const management = createPartnerManagement({ db, auth, ...managementOptions });
  const assess = monitoringOptions.assess || createPlantingPhotoAssessor({ db });
  const monitoring = createPlantingMonitoring({ db, getBucket, logger, ...monitoringOptions, assess });
  const vegetation = createProjectVegetation(vegetationOptions);
  const carbonImpact = createPiaTreeCarbonImpact({ db });
  const inAppNotifications = createInAppProjectNotifications({ db });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1, fieldSize: 16 * 1024 } });
  router.use(async (req, _res, next) => {
    try {
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
      if (!token) fail(401, 'Please sign in to continue.');
      let decoded;
      try { decoded = await auth.verifyIdToken(token, true); }
      catch (_) { fail(401, 'Your session has expired. Please sign in again.'); }
      req.identity = { uid: decoded.uid, email: decoded.email || '', signInProvider: decoded.firebase?.sign_in_provider };
      const scopedMembership = await db.collection('partnerV2Users').doc(decoded.uid).get();
      const membership = scopedMembership.exists ? scopedMembership : await db.collection('partnerUsers').doc(decoded.uid).get();
      if (!scopedMembership.exists && membership.data()?.membershipVersion === 2) {
        await requirePasswordIdentity(auth,req.identity);
        const org = await db.collection('organizations').doc(membership.data().orgId).get();
        if (!org.exists || org.data().status !== 'active') fail(403,'The organisation is inactive.');
        const isProjectPartnerLookup = req.path === '/project-partners' && req.method === 'GET';
        const isProjectNotifications = req.path === '/project-notifications' && req.method === 'GET';
        const isTreeSpecies = req.path === '/tree-species' && req.method === 'GET';
        const isWaterBodyMasterRead = req.path === '/water-body/masters' && req.method === 'GET';
        const isMapTilesToken = req.path === '/maps/tiles/token' && req.method === 'GET';
        const isMapPreview = /^\/projects\/[^/]+\/report\/map$/.test(req.path) && req.method === 'GET';
        if ((!/^\/(projects(?:\/|$)|me$|account$)/.test(req.path) && !isProjectPartnerLookup && !isProjectNotifications && !isTreeSpecies && !isWaterBodyMasterRead && !isMapTilesToken && !isMapPreview) || (req.path === '/account' && req.method !== 'GET')) fail(403,'Use the sustainability v2 account and member APIs.');
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
    try { const scoped = await db.collection('partnerV2Users').doc(req.identity.uid).get();
      const user = scoped.exists ? scoped : await db.collection('partnerUsers').doc(req.identity.uid).get();
      let data = user.exists ? user.data() : null;
      if (scoped.exists) {
        const portalUser = await db.collection('partnerUsers').doc(req.identity.uid).get();
        if (portalUser.exists && (portalUser.data().roles || []).includes('puviyan_admin')) {
          data = { ...data, roles: [...new Set([...(data.roles || []), 'puviyan_admin'])] };
        }
      }
      let collaborationMap = {};
      if (data?.membershipVersion === 2 && data.orgId && (data.accountType === 'sustainability_service_provider' || (data.roles || []).includes('sustainability_service_provider'))) {
        const links = await db.collection('partnerV2Collaborators').where('providerOrgId', '==', data.orgId).limit(500).get();
        collaborationMap = Object.fromEntries(links.docs.filter(d => d.data().status === 'active').map(d => [d.data().actionOwnerOrgId, d.data().access]));
      }
      req.context = contextFor(req.identity.uid,data,collaborationMap); next();
    } catch(error) { next(error); }
  });
  // Issue short-lived OAuth credentials for Google Map Tiles. The runtime
  // identity has only Service Usage Consumer permission; never ship a
  // long-lived Maps API key in the Flutter bundle.
  router.get('/maps/tiles/token', wrap(async (req, res) => {
    if (!req.context?.uid) fail(401, 'Please sign in to continue.');
    const metadataUrl = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
    const response = await fetch(metadataUrl, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      logger.error?.('Map Tiles OAuth token request failed', { status: response.status });
      fail(503, '3D map access is temporarily unavailable.');
    }
    const credential = await response.json();
    const projectId = process.env.MAP_TILES_BILLING_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'puviyan-partner-stage';
    res.set('Cache-Control', 'no-store');
    res.json({ accessToken: credential.access_token, expiresIn: credential.expires_in, projectId });
  }));
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
    if (!project) fail(404, 'Project not found.');
    const c = req.context;
    const isOwner = c.superAdmin || c.orgId === project.orgId;
    const collaborationAccess = c.collaborations?.[project.orgId];
    let assignedPartner = null;
    if (!isOwner && !collaborationAccess && c.orgId) {
      const assignment = await ref.collection('partners').where('partnerOrgId', '==', c.orgId).limit(1).get();
      assignedPartner = assignment.docs[0]?.data() || null;
    }
    if (!isOwner && !collaborationAccess && !assignedPartner) fail(403, 'This organisation is outside your access.');
    if (c.departmentScoped && isOwner && !c.departmentIds.includes(project.departmentId)) fail(403, 'This project is outside your department access.');
    if (write) {
      if (!c.canWrite) fail(403, 'Your approved roles allow viewing only.');
      if (collaborationAccess && (!c.providerCanWrite || collaborationAccess !== 'write')) fail(403, 'Your approved roles allow viewing only.');
      if (assignedPartner && assignedPartner.access !== 'write') fail(403, 'This partner has view-only access to the project.');
    }
    return { ref, project, assignedPartner, isOwner };
  }
  router.get('/projects/:id/report/map', wrap(async (req, res) => {
    const { project } = await loadProject(req);
    const apiKey = process.env.GOOGLE_MAPS_STATIC_API_KEY;
    if (!apiKey) fail(503, 'Google map previews are not configured yet.');
    const boundary = project.boundary || {};
    const center = boundary.center || boundary;
    const lat = Number(center.latitude ?? center.lat);
    const lng = Number(center.longitude ?? center.lng ?? center.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      fail(422, 'This project does not have a valid map location.');
    }
    const params = new URLSearchParams({
      size: '640x360',
      scale: '2',
      maptype: 'satellite',
      markers: `color:green|${lat},${lng}`,
      key: apiKey,
    });
    const vertices = boundary.vertices;
    if (Array.isArray(vertices) && vertices.length >= 3) {
      const encodeValue = value => {
        let encoded = value < 0 ? ~(value << 1) : value << 1;
        let result = '';
        while (encoded >= 0x20) {
          result += String.fromCharCode((0x20 | (encoded & 0x1f)) + 63);
          encoded >>= 5;
        }
        return result + String.fromCharCode(encoded + 63);
      };
      let previousLat = 0, previousLng = 0;
      let path = '';
      for (const point of vertices) {
        const pointLat = Math.round(point.latitude * 1e5);
        const pointLng = Math.round(point.longitude * 1e5);
        path += encodeValue(pointLat - previousLat) + encodeValue(pointLng - previousLng);
        previousLat = pointLat;
        previousLng = pointLng;
      }
      const first = vertices[0];
      path += encodeValue(Math.round(first.latitude * 1e5) - previousLat) +
        encodeValue(Math.round(first.longitude * 1e5) - previousLng);
      params.set('path', `fillcolor:0x39BE5740|color:0x39BE57FF|weight:3|enc:${path}`);
      // Frame the drawn polygon itself. The stored project pin may be several
      // kilometres away and must not pull the preview out to a broader area.
      const latitudes = vertices.map(point => Number(point.latitude)).filter(Number.isFinite);
      const longitudes = vertices.map(point => Number(point.longitude)).filter(Number.isFinite);
      if (latitudes.length >= 3 && longitudes.length >= 3) {
        const south = Math.min(...latitudes);
        const north = Math.max(...latitudes);
        const west = Math.min(...longitudes);
        const east = Math.max(...longitudes);
        const mapLat = (south + north) / 2;
        const mapLng = (west + east) / 2;
        const latitudeSpanMeters = Math.max(1, (north - south) * 111320);
        const longitudeSpanMeters = Math.max(
          1,
          (east - west) * 111320 * Math.cos(mapLat * Math.PI / 180),
        );
        const metersPerPixel = Math.max(
          latitudeSpanMeters / (360 * 0.78),
          longitudeSpanMeters / (640 * 0.78),
        );
        const zoom = Math.max(
          2,
          Math.min(20, Math.floor(Math.log2(156543.03392 * Math.cos(mapLat * Math.PI / 180) / metersPerPixel))),
        );
        params.set('center', `${mapLat},${mapLng}`);
        params.set('zoom', String(zoom));
      }
    } else {
      params.set('center', `${lat},${lng}`);
      params.set('zoom', '16');
    }
    const upstream = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params}`, {
      signal: AbortSignal.timeout(12000),
    });
    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !contentType.startsWith('image/')) {
      logger.error?.('Google Static Maps image request failed', { status: upstream.status, contentType });
      fail(502, 'Google map preview is temporarily unavailable.');
    }
    const image = Buffer.from(await upstream.arrayBuffer());
    if (!image.length || image.length > 5 * 1024 * 1024) fail(502, 'Google map preview could not be generated.');
    res.set('Cache-Control', 'private, max-age=3600');
    res.json({ imageBase64: image.toString('base64'), contentType });
  }));
  async function waterOutcomeAccess(req, permission = 'read') {
    const { ref, project } = await loadProject(req, false);
    if (project.scope !== 'water_body_rejuvenation') fail(400, 'Outcome tracking is available for water body projects.');
    const outcomeId = req.params.outcomeId;
    if (!Array.isArray(project.outcomes) || !project.outcomes.includes(outcomeId)) fail(404, 'This outcome is not selected for the project.');
    const c = req.context;
    const isOwner = c.superAdmin || c.orgId === project.orgId;
    const collaborationAccess = c.collaborations?.[project.orgId];
    const relations = !isOwner && c.orgId
      ? (await ref.collection('partners').where('partnerOrgId', '==', c.orgId).limit(20).get()).docs.map(d => d.data())
      : [];
    const canEdit = c.canWrite && (isOwner || (collaborationAccess === 'write' && c.providerCanWrite) || relations.some(r => r.partnerType === 'implementation' && r.access === 'write'));
    const canVerify = c.canWrite && (c.superAdmin || relations.some(r => r.partnerType === 'assurance' || r.role === 'assurance'));
    if (permission === 'edit' && !canEdit) fail(403, 'Only the action owner or write-enabled implementation partner can update outcome data.');
    if (permission === 'verify' && !canVerify) fail(403, 'Only an Assurance Partner can verify or flag readings.');
    return { ref, project, canEdit, canVerify };
  }
  const serialise = snapshot => ({ id: snapshot.id, ...snapshot.data() });
  const sortLatest = list => list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  router.get('/me', wrap(async (req, res) => {
    const c = req.context;
    const collaboratorLinks = c.orgId ? await db.collection('partnerV2Collaborators').where('providerOrgId', '==', c.orgId).limit(500).get() : { docs: [] };
    const collaborations = collaboratorLinks.docs.filter(d => d.data().status === 'active').map(d => ({ orgId: d.data().actionOwnerOrgId, orgName: d.data().actionOwnerOrgName, access: d.data().access }));
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
      departmentScoped: c.departmentScoped, departments, canWrite: c.canWrite, collaborations });
  }));
  router.get('/organisations', wrap(async (req, res) => {
    if (!req.context.superAdmin) fail(403, 'Super admin access is required.');
    const snapshot = await db.collection('organizations').limit(500).get();
    res.json({ organisations: snapshot.docs.map(d => ({ id: d.id, name: d.data().name || d.id })) });
  }));
  router.get('/projects/carbon-impact/organisation', wrap(async (req, res) => {
    const c = req.context;
    const orgId = req.query.orgId || c.orgId;
    if (!orgId) fail(400, 'Choose an organisation to view its carbon impact.');
    if (orgId !== c.orgId && !c.collaborations?.[orgId]) assertOrg(c, orgId);
    const org = await db.collection('organizations').doc(orgId).get();
    if (!org.exists) fail(404, 'Organisation not found.');
    const projectSnapshot = await projects.where('orgId', '==', orgId).limit(500).get();
    const visible = projectSnapshot.docs
      .filter(doc => !c.departmentScoped || c.departmentIds.includes(doc.data().departmentId))
      .filter(doc => !c.collaborations?.[doc.data().orgId] || Object.hasOwn(c.collaborations, doc.data().orgId));
    res.json(await carbonImpact.calculateOrganisation(orgId, visible));
  }));
  router.get('/projects', wrap(async (req, res) => {
    const c = req.context;
    const requestedOrgId = req.query.orgId || null;
    if (requestedOrgId && requestedOrgId !== c.orgId && !c.collaborations?.[requestedOrgId]) assertOrg(c, requestedOrgId);
    if (!requestedOrgId && !c.orgId && !c.superAdmin) fail(403, 'An organisation is required.');
    const orgIds = requestedOrgId ? [requestedOrgId] : c.superAdmin ? [] : [c.orgId, ...Object.keys(c.collaborations || {})].filter(Boolean);
    const snapshots = await Promise.all(orgIds.length ? orgIds.map(id => projects.where('orgId', '==', id).limit(500).get()) : [projects.limit(500).get()]);
    let assignedProjects = [];
    if (!c.superAdmin && c.orgId && (!requestedOrgId || requestedOrgId === c.orgId)) {
      const partnerRelations = await db.collectionGroup('partners').where('partnerOrgId', '==', c.orgId).limit(500).get();
      assignedProjects = await Promise.all(partnerRelations.docs
        .filter(doc => ['implementation', 'supporting', 'assurance'].includes(doc.data().partnerType))
        .map(doc => doc.ref.parent.parent)
        .filter(Boolean)
        .map(projectRef => projectRef.get()));
    }
    const projectDocs = [...snapshots.flatMap(s => s.docs), ...assignedProjects].filter(doc => doc.exists);
    const deduped = new Map(projectDocs.map(doc => [doc.id, doc]));
    const visible = [...deduped.values()].map(serialise).filter(p => (!c.departmentScoped || p.orgId !== c.orgId || c.departmentIds.includes(p.departmentId)) && (!c.collaborations?.[p.orgId] || Object.hasOwn(c.collaborations, p.orgId)));
    res.json({ projects: sortLatest(visible) });
  }));
  router.get('/project-partners', wrap(async (req, res) => {
    const type = req.query.type;
    if (!PARTNER_TYPES.has(type)) fail(400, 'Choose implementation, supporting, assurance or managed service partner type.');
    const directory = db.collection('partnerDirectory');
    const [singleType, multipleTypes] = await Promise.all([
      directory.where('partnerType', '==', type).limit(500).get(),
      directory.where('partnerTypes', 'array-contains', type).limit(500).get(),
    ]);
    const docs = new Map([...singleType.docs, ...multipleTypes.docs].map(doc => [doc.id, doc]));
    res.json({ partners: [...docs.values()]
      .filter(doc => !doc.data().status || doc.data().status === 'active')
      .map(doc => ({ id: doc.id, name: doc.data().name || doc.id, description: doc.data().description || '', partnerType: type, orgId: doc.data().orgId || doc.data().organizationId || null })) });
  }));
  router.get('/tree-species', wrap(async (_req, res) => {
    res.json({ species: FACTORS.map(({ id, species, scientificName }) => ({ id, name: species, scientificName })) });
  }));
  router.post('/projects', wrap(async (req, res) => {
    const c = req.context;
    if (!c.canWrite) fail(403, 'Your approved roles allow viewing only.');
    const orgId = req.body.orgId || c.orgId;
    if (orgId !== c.orgId && (!c.collaborations?.[orgId] || !c.providerCanWrite || c.collaborations[orgId] !== 'write')) assertOrg(c, orgId);
    const org = await db.collection('organizations').doc(orgId).get();
    if (!org.exists || (org.data().status && org.data().status !== 'active')) fail(400, 'Choose an active organisation.');
    const departmentId = req.body.departmentId || null;
    if (c.departmentScoped && !c.departmentIds.includes(departmentId)) fail(403, 'Select one of your assigned departments.');
    if (departmentId) {
      if (typeof departmentId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(departmentId)) fail(400, 'Invalid department.');
      const department = await db.collection('organizations').doc(orgId).collection('departments').doc(departmentId).get();
      if (!department.exists) fail(400, 'Department not found.');
    }
    if (req.body.scope === 'water_body_rejuvenation') {
      const built = await buildWaterBodyProject(req.body, { db, orgId, uid: c.uid });
      built.project.actionOwnerOrgName = org.data().name || orgId;
      built.project.departmentId = departmentId;
      const ref = await projects.add(built.project);
      await saveProjectRelations(ref, built.project, built.notificationPartners);
      if (built.project.status === 'baseline_pending') {
        await queuePartnerNotifications(db, ref.id, built.project, built.notificationPartners);
        await inAppNotifications.projectCreated({ projectId: ref.id, project: built.project, orgId }).catch((error) => {
          logger.warn('Project-created notification could not be queued', { projectId: ref.id, error: error.message });
        });
      }
      return res.status(201).json({ project: { id: ref.id, ...built.project } });
    }
    if (req.body.scope !== 'plant_trees') fail(400, 'Choose Plant trees or Water Body Rejuvenation.');
    const projectDate = (value, label) => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, `${label} must be a valid calendar date.`);
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(400, `${label} must be a valid calendar date.`);
      return value;
    };
    const startDate = projectDate(req.body.startDate, 'Project start date');
    const endDate = projectDate(req.body.endDate, 'Project end date');
    if (endDate < startDate) fail(400, 'Project end date must be on or after its start date.');
    let treeGoal;
    if (req.body.treeGoal !== undefined) {
      if (req.body.scope !== 'plant_trees') fail(400, 'Tree goals are only available for Plant Trees projects.');
      treeGoal = Number(req.body.treeGoal);
      if (!Number.isInteger(treeGoal) || treeGoal < 1 || treeGoal > 10000000) fail(400, 'Enter a tree goal between 1 and 10,000,000.');
    }
    const boundary = projectBoundary(req.body.boundary);
    let totalArea = null;
    if (req.body.totalArea != null) {
      const value = Number(req.body.totalArea.value);
      const unit = req.body.totalArea.unit;
      const factors = { acres: 4046.8564224, hectares: 10000, 'sq m': 1 };
      if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000 || !Object.hasOwn(factors, unit)) {
        fail(400, 'Enter a valid positive project area in acres, hectares or sq m.');
      }
      totalArea = { value, unit, squareMetres: value * factors[unit] };
    }
    let plannedSpecies;
    if (req.body.plannedSpecies !== undefined) {
      if (!Array.isArray(req.body.plannedSpecies) || req.body.plannedSpecies.length > 100) {
        fail(400, 'Planned species must be a list of up to 100 entries.');
      }
      plannedSpecies = req.body.plannedSpecies.map(item => {
        const species = typeof item?.species === 'string' ? item.species.trim() : '';
        const count = Number(item?.count);
        if (!species || species.length > 100 || !Number.isInteger(count) || count < 1 || count > 10_000_000) {
          fail(400, 'Each planned species needs a name and a count between 1 and 10,000,000.');
        }
        return { species, count };
      });
    }
    const treeOutcomeIds = new Set([
      'native_tree_cover',
      'biodiversity_habitat',
      'carbon_sequestration',
      'soil_health',
      'watershed_health',
      'community_benefits',
    ]);
    const outcomes = req.body.outcomes === undefined ? [] : req.body.outcomes;
    if (!Array.isArray(outcomes) || outcomes.some(id => typeof id !== 'string' || !treeOutcomeIds.has(id))) {
      fail(400, 'Choose valid outcomes for this tree planting project.');
    }
    if (new Set(outcomes).size === 0) fail(400, 'Select at least one tree planting project outcome.');
    const managedService = await selectedPartner(db, req.body.managedServicePartnerId, 'managed_service', true);
    const verificationAssistance = req.body.verificationAssistance ?? false;
    if (typeof verificationAssistance !== 'boolean') fail(400, 'Verification assistance selection must be Yes or No.');
    const assuranceInput = req.body.assurancePartners ?? [];
    if (!Array.isArray(assuranceInput)) fail(400, 'Assurance partners must be a list.');
    const assurancePartners = [];
    for (const item of assuranceInput) {
      if (!item || typeof item !== 'object' || !item.partnerId || !ASSURANCE_ROLES.has(item.role)) {
        fail(400, 'Choose a valid assurance partner and role.');
      }
      const partner = await selectedPartner(db, item.partnerId, 'assurance', true);
      assurancePartners.push({ ...partner, partnerType: 'assurance', role: item.role });
    }
    const isCsr = req.body.isCsr ?? false;
    if (typeof isCsr !== 'boolean') fail(400, 'CSR selection must be Yes or No.');
    const csrFinancialYear = isCsr ? req.body.csrFinancialYear : null;
    if (isCsr && (typeof csrFinancialYear !== 'string' || !/^\d{4}-\d{2}$/.test(csrFinancialYear))) {
      fail(400, 'Choose a valid CSR financial year.');
    }
    let csrBudget = null;
    if (isCsr && req.body.csrBudget != null) {
      const amount = Number(typeof req.body.csrBudget === 'object' ? req.body.csrBudget.amount : req.body.csrBudget);
      if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) fail(400, 'Enter a valid CSR budget amount.');
      csrBudget = { amount, currencyCode: 'INR' };
    }
    const timestamp = new Date().toISOString();
    const notificationPartners = [
      { ...managedService, partnerType: 'managed_service', role: 'Managed service partner' },
      ...assurancePartners,
    ];
    const projectDescription = typeof req.body.description === 'string'
      ? req.body.description.trim()
      : '';
    if (projectDescription.length > 2000) {
      fail(400, 'Description must be at most 2000 characters.');
    }
    const project = {
      name: text(req.body.name, 'Project name', 100), description: projectDescription,
      locationName: text(req.body.locationName, 'Location', 200), scope: req.body.scope,
      startDate, endDate,
      ...(treeGoal !== undefined ? { treeGoal } : {}),
      ...(totalArea ? { totalArea } : {}),
      ...(plannedSpecies ? { plannedSpecies } : {}),
      outcomes: [...new Set(outcomes)],
      managedServicePartnerId: managedService.partnerId,
      managedServicePartnerName: managedService.name,
      verificationAssistance,
      assurancePartners: assurancePartners.map(({ partnerOrgId, ...partner }) => partner),
      isCsr,
      csrFinancialYear,
      csrBudget,
      orgId, departmentId, createdByUid: c.uid, createdAt: timestamp, status: 'active',
      updatedAt: timestamp,
      ...(boundary ? { boundary } : {}),
    };
    const ref = await projects.add(project);
    await saveProjectRelations(ref, project, notificationPartners);
    await queuePartnerNotifications(db, ref.id, project, notificationPartners);
    await inAppNotifications.projectCreated({ projectId: ref.id, project, orgId }).catch((error) => {
      logger.warn('Project-created notification could not be queued', { projectId: ref.id, error: error.message });
    });
    res.status(201).json({ project: { id: ref.id, ...project } });
  }));
  router.patch('/projects/:id', wrap(async (req, res) => {
    const { ref, project: current } = await loadProject(req, true);
    if (current.scope !== 'water_body_rejuvenation') fail(400, 'Use the water body project update flow for this project.');
    const org = await db.collection('organizations').doc(current.orgId).get();
    if (!org.exists) fail(404, 'Action owner organisation not found.');
    const built = await buildWaterBodyProject(req.body, { db, orgId: current.orgId, uid: req.context.uid, existing: current });
    built.project.actionOwnerOrgName = org.data().name || current.orgId;
    built.project.departmentId = current.departmentId || null;
    const changedFields = ['name', 'description', 'locationName', 'waterBodyType', 'totalArea', 'boundary', 'implementationPartnerId', 'supportingPartnerIds', 'assurancePartners', 'startDate', 'endDate', 'isCsr', 'csrFinancialYear', 'csrBudget', 'outcomes']
      .filter(key => JSON.stringify(current[key] ?? null) !== JSON.stringify(built.project[key] ?? null));
    await ref.set(built.project);
    if (changedFields.length) await ref.collection('auditLog').add({
      eventType: 'project.updated', actorUid: req.context.uid, changedFields,
      before: Object.fromEntries(changedFields.map(key => [key, current[key] ?? null])),
      after: Object.fromEntries(changedFields.map(key => [key, built.project[key] ?? null])),
      createdAt: built.project.updatedAt,
    });
    await saveProjectRelations(ref, built.project, built.notificationPartners);
    if (current.status === 'draft' && built.project.status === 'baseline_pending') {
      await queuePartnerNotifications(db, ref.id, built.project, built.notificationPartners);
      await inAppNotifications.projectCreated({ projectId: ref.id, project: built.project, orgId: built.project.orgId }).catch((error) => {
        logger.warn('Project-created notification could not be queued', { projectId: ref.id, error: error.message });
      });
    }
    return res.json({ project: { id: ref.id, ...built.project } });
  }));
  router.patch('/projects/:id/status', wrap(async (req, res) => {
    const { ref, project } = await loadProject(req, true);
    if (project.scope !== 'water_body_rejuvenation') fail(400, 'Only water body projects use this status flow.');
    const transitions = {
      baseline_pending: 'active',
      active: 'under_assurance',
      under_assurance: 'completed',
    };
    if (project.status === 'draft') fail(400, 'Complete the required project details before creating the project.');
    if (req.body.status !== transitions[project.status]) {
      fail(400, 'Project status must move to the next step in the project lifecycle.');
    }
    const updatedAt = new Date().toISOString();
    await ref.update({ status: req.body.status, updatedAt });
    return res.json({ project: { id: ref.id, ...project, status: req.body.status, updatedAt } });
  }));
  router.patch('/projects/:id/outcomes', wrap(async (req, res) => {
    const { ref, project } = await loadProject(req, true);
    if (project.scope !== 'water_body_rejuvenation') fail(400, 'Outcomes are available for water body projects.');
    if (!Array.isArray(req.body.outcomes)) fail(400, 'Supply the project outcome targets.');
    const selected = new Set(project.outcomes || []);
    const batch = db.batch();
    for (const item of req.body.outcomes) {
      if (!item || typeof item.outcomeId !== 'string' || !selected.has(item.outcomeId)) {
        fail(400, 'Update only outcomes selected for this project.');
      }
      const target = item.target == null || item.target === '' ? null : Number(item.target);
      if (target != null && (!Number.isFinite(target) || target < 0)) fail(400, 'Outcome targets must be zero or a positive number.');
      const targetUnit = item.targetUnit == null || item.targetUnit === '' ? null : text(item.targetUnit, 'Target unit', 30);
      batch.set(ref.collection('outcomes').doc(item.outcomeId), {
        projectId: ref.id,
        outcomeId: item.outcomeId,
        target,
        targetUnit,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
    await batch.commit();
    const results = await ref.collection('outcomes').get();
    return res.json({ outcomes: results.docs.map(serialise) });
  }));
  router.get('/water-body/masters', wrap(async (req, res) => res.json(await waterOutcomeMasters.masters(db))));
  router.put('/water-body/masters', wrap(async (req, res) => {
    if (!req.context.superAdmin) fail(403, 'Super admin access is required to edit water-body masters.');
    const { metrics, actions, outcomeNames } = req.body || {};
    if (!Array.isArray(metrics) || !Array.isArray(actions) || !outcomeNames || typeof outcomeNames !== 'object') fail(400, 'Supply metrics, actions and outcome names.');
    await db.collection('waterBodyMasters').doc('default').set({ metrics, actions, outcomeNames, updatedAt: new Date().toISOString(), updatedBy: req.context.uid });
    return res.json({ status: 'saved' });
  }));
  router.get('/projects/:id/outcomes/:outcomeId', wrap(async (req, res) => {
    const { ref, project, canEdit, canVerify } = await waterOutcomeAccess(req, 'read');
    const master = await waterOutcomeMasters.masters(db);
    const outcomeRef = ref.collection('outcomes').doc(req.params.outcomeId);
    const outcomeSnapshot = await outcomeRef.get();
    const outcome = outcomeSnapshot.exists ? outcomeSnapshot.data() : {};
    const metricDefinitions = master.metrics.filter(m => m.outcomeId === req.params.outcomeId);
    const defaults = metricDefinitions.filter(m => m.isDefault && !m.autoCalculated).map(m => m.id);
    const selectedMetrics = [...new Set([...(outcome.selectedMetrics || defaults), ...defaults])];
    const [before, targets, readings, actionSnapshot] = await Promise.all([
      outcomeRef.collection('before').get(), outcomeRef.collection('targets').get(),
      outcomeRef.collection('readings').orderBy('date', 'desc').limit(500).get(), ref.collection('actions').limit(500).get(),
    ]);
    const signed = async doc => {
      const value = { id: doc.id, ...doc.data() };
      if (value.evidenceStoragePath) {
        const [url] = await getBucket().file(value.evidenceStoragePath).getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1000 });
        value.evidenceUrl = url;
      }
      return value;
    };
    return res.json({
      projectId: ref.id, outcomeId: req.params.outcomeId,
      outcomeName: master.outcomeNames[req.params.outcomeId] || req.params.outcomeId,
      selectedOutcomes: project.outcomes || [], selectedMetrics, metrics: metricDefinitions,
      actionsCatalog: master.actions.filter(a => (a.outcomeIds || []).includes(req.params.outcomeId)),
      before: await Promise.all(before.docs.map(signed)),
      baselineCorrections: await Promise.all(before.docs.map(async doc => ({ metricId: doc.id, records: await Promise.all((await doc.ref.collection('corrections').orderBy('createdAt', 'desc').limit(100).get()).docs.map(signed)) }))),
      targets: targets.docs.map(serialise),
      readings: await Promise.all(readings.docs.map(signed)),
      actions: actionSnapshot.docs.map(serialise).filter(a => (a.outcomeIds || []).includes(req.params.outcomeId)),
      canEdit, canVerify,
    });
  }));
  router.put('/projects/:id/outcomes/:outcomeId/metrics', wrap(async (req, res) => {
    const { ref } = await waterOutcomeAccess(req, 'edit');
    const master = await waterOutcomeMasters.masters(db);
    if (!Array.isArray(req.body.metricIds)) fail(400, 'Choose one or more project metrics.');
    const definitions = master.metrics.filter(m => m.outcomeId === req.params.outcomeId);
    const defaults = definitions.filter(m => m.isDefault && !m.autoCalculated).map(m => m.id);
    const selectedMetrics = [...new Set([...defaults, ...req.body.metricIds])];
    if (selectedMetrics.some(id => !definitions.some(m => m.id === id && !m.autoCalculated))) fail(400, 'Choose metrics available for this outcome.');
    const outcomeRef = ref.collection('outcomes').doc(req.params.outcomeId);
    const previous = await outcomeRef.get();
    const stamp = new Date().toISOString();
    await outcomeRef.set({ outcomeId: req.params.outcomeId, projectId: ref.id, selectedMetrics, updatedAt: stamp }, { merge: true });
    await ref.collection('auditLog').add({ eventType: 'outcome.metrics.updated', actorUid: req.context.uid, outcomeId: req.params.outcomeId, before: previous.data()?.selectedMetrics || defaults, after: selectedMetrics, createdAt: stamp });
    return res.json({ selectedMetrics });
  }));
  router.put('/projects/:id/outcomes/:outcomeId/before/:metricId', wrap(async (req, res) => {
    const { ref } = await waterOutcomeAccess(req, 'edit');
    const master = await waterOutcomeMasters.masters(db);
    const metric = waterOutcomeMasters.findMetric(master, req.params.outcomeId, req.params.metricId);
    if (!metric || metric.autoCalculated) fail(400, 'Choose an editable metric for this outcome.');
    const value = waterOutcomeMasters.numberValue(req.body.value, 'Baseline value');
    if (req.body.unit !== metric.unit) fail(400, `Use the fixed unit ${metric.unit} for ${metric.name}.`);
    const date = validDate(req.body.date, 'Baseline date').slice(0, 10);
    const evidence = text(req.body.evidence, 'Evidence', 2000);
    const quality = req.params.outcomeId === 'improved_water_quality';
    const testedBy = quality ? text(req.body.testedBy, 'Lab or agency', 160) : null;
    const nablAccredited = quality ? req.body.nablAccredited : null;
    if (quality && typeof nablAccredited !== 'boolean') fail(400, 'Choose whether the lab or agency is NABL accredited.');
    const recordRef = ref.collection('outcomes').doc(req.params.outcomeId).collection('before').doc(req.params.metricId);
    const previous = await recordRef.get();
    const stamp = new Date().toISOString();
    const previousData = previous.exists ? previous.data() : null;
    const isCorrection = previousData?.verificationStatus === 'verified';
    if (isCorrection) {
      await recordRef.collection('corrections').add({ ...previousData, replacedAt: stamp, replacedByUid: req.context.uid, correctionReason: text(req.body.correctionReason, 'Correction reason', 300) });
    }
    const data = { projectId: ref.id, outcomeId: req.params.outcomeId, metricId: metric.id, metricName: metric.name, value, unit: metric.unit, date, evidence, testedBy, nablAccredited, verificationStatus: 'pending', createdBy: req.context.uid, createdAt: stamp, updatedAt: stamp, ...(isCorrection ? { correctionOfVerifiedBaseline: true, correctionReason: text(req.body.correctionReason, 'Correction reason', 300) } : {}) };
    await recordRef.set(data);
    await ref.collection('auditLog').add({ eventType: isCorrection ? 'outcome.baseline.corrected' : 'outcome.baseline.saved', actorUid: req.context.uid, outcomeId: req.params.outcomeId, metricId: metric.id, before: previousData, after: data, createdAt: stamp });
    return res.json({ baseline: { id: recordRef.id, ...data }, correction: isCorrection });
  }));
  router.put('/projects/:id/outcomes/:outcomeId/targets/:metricId', wrap(async (req, res) => {
    const { ref } = await waterOutcomeAccess(req, 'edit');
    const master = await waterOutcomeMasters.masters(db);
    const metric = waterOutcomeMasters.findMetric(master, req.params.outcomeId, req.params.metricId);
    if (!metric || metric.autoCalculated) fail(400, 'Choose an editable metric for this outcome.');
    const outcomeRef = ref.collection('outcomes').doc(req.params.outcomeId);
    if (!(await outcomeRef.collection('before').doc(req.params.metricId).get()).exists) fail(409, 'Add the baseline reading before setting a target.');
    const value = waterOutcomeMasters.numberValue(req.body.value, 'Target value');
    const targetDate = validDate(req.body.targetDate, 'Target date').slice(0, 10);
    const stamp = new Date().toISOString();
    const targetRef = outcomeRef.collection('targets').doc(metric.id);
    const previous = await targetRef.get();
    const data = { projectId: ref.id, outcomeId: req.params.outcomeId, metricId: metric.id, metricName: metric.name, value, unit: metric.unit, targetDate, updatedBy: req.context.uid, updatedAt: stamp };
    await targetRef.set(data);
    await ref.collection('auditLog').add({ eventType: 'outcome.target.saved', actorUid: req.context.uid, outcomeId: req.params.outcomeId, metricId: metric.id, before: previous.exists ? previous.data() : null, after: data, createdAt: stamp });
    return res.json({ target: data });
  }));
  router.post('/projects/:id/outcomes/:outcomeId/readings', wrap(async (req, res) => {
    const { ref } = await waterOutcomeAccess(req, 'edit');
    const master = await waterOutcomeMasters.masters(db);
    const metric = waterOutcomeMasters.findMetric(master, req.params.outcomeId, req.body.metricId);
    if (!metric || metric.autoCalculated) fail(400, 'Choose an editable metric for this outcome.');
    const outcomeRef = ref.collection('outcomes').doc(req.params.outcomeId);
    if (!(await outcomeRef.collection('before').doc(metric.id).get()).exists) fail(409, 'Add a baseline before recording an after reading.');
    const value = waterOutcomeMasters.numberValue(req.body.value, 'Reading value');
    if (req.body.unit !== metric.unit) fail(400, `Use the fixed unit ${metric.unit} for ${metric.name}.`);
    const date = validDate(req.body.date, 'Reading date').slice(0, 10);
    const evidence = text(req.body.evidence, 'Evidence', 2000);
    const quality = req.params.outcomeId === 'improved_water_quality';
    const testedBy = quality ? text(req.body.testedBy, 'Lab or agency', 160) : null;
    const nablAccredited = quality ? req.body.nablAccredited : null;
    if (quality && typeof nablAccredited !== 'boolean') fail(400, 'Choose whether the lab or agency is NABL accredited.');
    const takenAfterActionId = req.body.takenAfterActionId || null;
    if (takenAfterActionId) {
      const action = await ref.collection('actions').doc(takenAfterActionId).get();
      if (!action.exists || !(action.data().outcomeIds || []).includes(req.params.outcomeId)) fail(400, 'Choose an action linked to this outcome.');
    }
    const stamp = new Date().toISOString();
    const recordRef = outcomeRef.collection('readings').doc();
    const data = { projectId: ref.id, outcomeId: req.params.outcomeId, metricId: metric.id, metricName: metric.name, value, unit: metric.unit, date, evidence, testedBy, nablAccredited, takenAfterActionId, verificationStatus: 'pending', createdBy: req.context.uid, createdAt: stamp };
    await recordRef.set(data);
    await ref.collection('auditLog').add({ eventType: 'outcome.after.saved', actorUid: req.context.uid, outcomeId: req.params.outcomeId, metricId: metric.id, recordId: recordRef.id, after: data, createdAt: stamp });
    return res.status(201).json({ reading: { id: recordRef.id, ...data } });
  }));
  router.post('/projects/:id/actions', wrap(async (req, res) => {
    const { ref, project } = await loadProject(req, true);
    if (project.scope !== 'water_body_rejuvenation') fail(400, 'Actions are available for water body projects.');
    const master = await waterOutcomeMasters.masters(db);
    const definition = master.actions.find(a => a.id === req.body.catalogId);
    if (!definition) fail(400, 'Choose an action from the project action list.');
    const outcomeIds = [...new Set(req.body.outcomeIds || [])];
    if (!outcomeIds.length || outcomeIds.some(id => !(definition.outcomeIds || []).includes(id) || !(project.outcomes || []).includes(id))) fail(400, 'Link the action to eligible selected outcomes.');
    const quantity = waterOutcomeMasters.numberValue(req.body.quantity, 'Output quantity');
    const quantityUnit = text(req.body.quantityUnit, 'Output unit', 40);
    const evidence = text(req.body.evidence, 'Action evidence', 2000);
    const stamp = new Date().toISOString();
    const recordRef = ref.collection('actions').doc();
    const data = { projectId: ref.id, catalogId: definition.id, name: definition.name, outcomeIds, quantity, quantityUnit, evidence, createdBy: req.context.uid, createdAt: stamp, updatedAt: stamp };
    await recordRef.set(data);
    await ref.collection('auditLog').add({ eventType: 'outcome.action.added', actorUid: req.context.uid, actionId: recordRef.id, after: data, outcomeIds, createdAt: stamp });
    return res.status(201).json({ action: { id: recordRef.id, ...data } });
  }));
  async function verifyWaterReading(req, res, kind) {
    const { ref } = await waterOutcomeAccess(req, 'verify');
    const outcomeRef = ref.collection('outcomes').doc(req.params.outcomeId);
    const recordRef = kind === 'baseline' ? outcomeRef.collection('before').doc(req.params.metricId) : outcomeRef.collection('readings').doc(req.params.readingId);
    const snapshot = await recordRef.get();
    if (!snapshot.exists) fail(404, 'Reading not found.');
    const status = req.body.verificationStatus;
    if (!['verified', 'flagged'].includes(status)) fail(400, 'Choose Verified or Flagged.');
    if (snapshot.data().verificationStatus === 'verified' && status !== 'verified') fail(409, 'A verified reading cannot be changed.');
    const verifierOrg = req.context.orgId ? await db.collection('organizations').doc(req.context.orgId).get() : null;
    const verifierName = req.context.superAdmin ? 'Puviyan Super Admin' : verifierOrg?.data()?.name || req.identity.email || 'Assurance Partner';
    const stamp = new Date().toISOString();
    const verification = { verificationStatus: status, verifiedByOrgId: req.context.orgId || null, verifiedByName: verifierName, verifiedByUid: req.context.uid, verifiedAt: stamp, verificationNote: (req.body.note || '').toString().trim().slice(0, 500) };
    await recordRef.update(verification);
    await ref.collection('auditLog').add({ eventType: `outcome.${kind}.${status}`, actorUid: req.context.uid, outcomeId: req.params.outcomeId, metricId: req.params.metricId || snapshot.data().metricId, recordId: recordRef.id, before: snapshot.data(), after: { ...snapshot.data(), ...verification }, createdAt: stamp });
    return res.json({ verificationStatus: status, verifiedByName: verifierName, verifiedAt: stamp });
  }
  router.patch('/projects/:id/outcomes/:outcomeId/before/:metricId/verification', wrap(async (req, res) => verifyWaterReading(req, res, 'baseline')));
  router.patch('/projects/:id/outcomes/:outcomeId/readings/:readingId/verification', wrap(async (req, res) => verifyWaterReading(req, res, 'reading')));
  router.get('/project-notifications', wrap(async (req, res) => {
    const orgId = req.context.orgId;
    if (!orgId) return res.json({ notifications: [] });
    await inAppNotifications.materializeDueGrowthReminders(orgId).catch((error) => {
      // A missing or still-building Firestore index must not make the entire
      // notifications feed unavailable. Existing notifications remain useful;
      // due reminders can be materialized on the next refresh.
      logger.warn('Due growth reminders could not be materialized', {
        orgId,
        error: error.message,
      });
    });
    const [directoryByOrg, directoryByOrganization] = await Promise.all([
      db.collection('partnerDirectory').where('orgId', '==', orgId).limit(100).get(),
      db.collection('partnerDirectory').where('organizationId', '==', orgId).limit(100).get(),
    ]);
    const partners = [...new Set([...directoryByOrg.docs, ...directoryByOrganization.docs].map(doc => doc.id))];
    const queries = [db.collection('partnerProjectNotifications').where('recipientOrgId', '==', orgId).limit(200).get()];
    for (let index = 0; index < partners.length; index += 30) {
      queries.push(db.collection('partnerProjectNotifications').where('partnerId', 'in', partners.slice(index, index + 30)).limit(200).get());
    }
    const snapshots = await Promise.all(queries);
    const notifications = new Map();
    for (const snapshot of snapshots) for (const doc of snapshot.docs) notifications.set(doc.id, serialise(doc));
    res.json({ notifications: sortLatest([...notifications.values()]) });
  }));
  router.get('/projects/:id', wrap(async (req, res) => {
    const { ref, project } = await loadProject(req);
    const isWaterBody = project.scope === 'water_body_rejuvenation';
    const [events, trees, outcomes, partners, impact] = await Promise.all([
      isWaterBody ? Promise.resolve({ docs: [] }) : ref.collection('events').limit(500).get(),
      isWaterBody ? Promise.resolve({ docs: [] }) : ref.collection('trees').limit(500).get(),
      ref.collection('outcomes').limit(100).get(),
      ref.collection('partners').limit(100).get(),
      isWaterBody ? Promise.resolve(null) : carbonImpact.calculateProject(ref.id, project),
    ]);
    const records = await Promise.all(trees.docs.map(async doc => {
      const { storagePath, contextStoragePath, fingerprint, imageHashes, perceptualHash, contextPerceptualHash, captureSessionId, ...record } = doc.data();
      // Only authenticated, scoped reads mint short-lived URLs; the bucket stays private.
      const [photoUrl] = await getBucket().file(storagePath).getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1000 });
      const result = { id: doc.id, ...record, photoUrl, carbonImpact: impact?.plantings[doc.id] || null };
      if (contextStoragePath) [result.contextPhotoUrl] = await getBucket().file(contextStoragePath).getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1000 });
      return result;
    }));
    res.json({ project: { id: ref.id, ...project, outcomeDetails: outcomes.docs.map(serialise), projectPartners: partners.docs.map(serialise), carbonImpact: impact?.summary || null }, events: sortLatest(events.docs.map(serialise)), trees: sortLatest(records) });
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
    assertProjectBoundary(project, data);
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
        const createdAt = new Date().toISOString();
        const point = { projectId: ref.id, treeId: treeRef.id, orgId: project.orgId, latitude: data.latitude, longitude: data.longitude, accuracyMeters: data.accuracyMeters };
        tx.create(treeRef, { ...data, projectId: ref.id, orgId: project.orgId, departmentId: project.departmentId || null,
          storagePath, fingerprint, createdByUid: req.context.uid, createdAt, verificationStatus: 'submitted' });
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
  router.get('/projects/:id/vegetation', wrap(async (req, res) => {
    const { project } = await loadProject(req);
    res.set('Cache-Control', 'private, max-age=300');
    res.json(await vegetation.image({
      projectId: req.params.id,
      boundary: project.boundary,
      from: req.query.from,
      to: req.query.to,
    }));
  }));
  router.post('/projects/:id/plantings/remote-imagery', plantingUpload.single('photo'), wrap(async (req,res) => {
    if(!req.file) fail(400,'An imagery preview is required.');
    const result=await monitoring.remote(req.context,req.params.id,parsePlanting(req),req.file.buffer);res.status(result.created?201:200).json(result);
  }));
  router.get('/projects/:id/plantings/:plantingId', wrap(async (req,res) => res.json(await monitoring.detail(req.context,req.params.id,req.params.plantingId))));
  router.patch('/projects/:id/plantings/:plantingId/species', wrap(async (req,res) => res.json(await monitoring.confirmSpecies(req.context,req.params.id,req.params.plantingId,req.body))));
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
