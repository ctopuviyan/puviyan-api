const test = require('node:test');
const assert = require('node:assert/strict');
const { contextFor, assertProject, treeMetadata, imageType } = require('../src/services/partner-project-policy');
const express = require('express');
const { createPartnerAppRouter } = require('../src/routes/partner-app.routes');
const now = new Date().toISOString();
const tree = () => ({ recordId: 'a'.repeat(32), species: 'Neem', notes: '', latitude: 12.9,
  longitude: 80.1, accuracyMeters: 5, capturedAt: now, locationCapturedAt: now, photoSource: 'camera' });
const project = { orgId: 'org1', departmentId: 'dept1', name: 'Green Chennai', scope: 'plant_trees', createdAt: now };
function memoryDb() {
  const records = new Map([
    ['partnerUsers/admin', { orgId: 'org1', roles: ['org_admin'], status: 'active' }],
    ['partnerUsers/reader', { orgId: 'org1', roles: ['org_analyst'] }],
    ['partnerUsers/other', { orgId: 'org2', roles: ['partner_staff'] }],
    ['partnerUsers/scoped', { orgId: 'org1', roles: ['partner_staff'], scope: { type: 'departments', departmentIds: ['dept2'] } }],
    ['partnerUsers/root', { roles: ['puviyan_admin'] }],
    ['partnerUsers/disabled', { orgId: 'org1', roles: ['org_admin'], status: 'disabled' }],
    ['organizations/org1', { name: 'Organisation One', status: 'active' }],
    ['organizations/org2', { name: 'Organisation Two', status: 'active' }],
    ['partnerProjects/p1', project],
    ['partnerProjects/p2', { ...project, scope: 'prevent_soil_erosion' }],
  ]);
  let next = 0;
  function doc(path) {
    return { id: path.split('/').pop(), path,
      get: async () => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) }),
      collection: name => collection(`${path}/${name}`) };
  }
  function collection(path, filters = []) {
    return { doc: id => doc(`${path}/${id}`),
      where: (key, _op, value) => collection(path, [...filters, [key, value]]),
      limit: () => collection(path, filters),
      add: async value => { const ref = doc(`${path}/new${++next}`); records.set(ref.path, value); return ref; },
      get: async () => ({ docs: [...records.entries()].filter(([key, value]) => key.startsWith(`${path}/`) &&
        key.split('/').length === path.split('/').length + 1 && filters.every(([k,v]) => value[k] === v))
        .map(([path, value]) => ({ id: path.split('/').pop(), data: () => value })) }),
    };
  }
  return { records, collection, runTransaction: async fn => fn({ get: ref => ref.get(), create: (ref, value) => records.set(ref.path, value) }) };
}
async function fixture(fn) {
  const db = memoryDb(); const files = new Map();
  const bucket = { file: path => ({ save: async buffer => files.set(path, buffer),
    delete: async () => files.delete(path), getSignedUrl: async () => [`https://private.example/${path}`] }) };
  const auth = { verifyIdToken: async token => { if (token === 'expired' || token === 'consumer-admin') throw Error('invalid partner token'); return { uid: token }; } };
  const app = express();
  app.use(express.json());
  // Model neighbouring legacy route groups to catch namespace and error-handler leakage.
  app.get('/api/v1/partner/me', (_req, res) => res.json({ legacyPartner: true }));
  app.use('/api/v1/partner-app', createPartnerAppRouter({ db, auth, getBucket: () => bucket, logger: { error() {} } }));
  app.get('/api/v1/points/balance', (_req, res) => res.json({ balance: 42 }));
  app.use((_req, res) => res.status(404).json({ message: 'Not found.' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/partner-app`;
  async function request(path, user = 'admin', body, method) {
    const form = body instanceof FormData;
    return fetch(`${base}${path}`, { method: method || (body ? 'POST' : 'GET'),
      headers: { ...(user ? { Authorization: `Bearer ${user}` } : {}), ...(body && !form ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: form ? body : JSON.stringify(body) } : {}) });
  }
  try { await fn({ request, db, files, root: base.replace(/\/partner-app$/, '') }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
function upload(metadata = tree(), bytes = Buffer.from([255,216,255,1,2,3])) {
  const form = new FormData();
  form.set('metadata', JSON.stringify(metadata));
  form.set('photo', new Blob([bytes]), 'tree.jpg');
  return form;
}

test('roles merge legacy single role and multiple roles without dropping super admin', () => {
  const c = contextFor('u1', { role: 'puviyan_admin', roles: ['org_analyst'] });
  assert.equal(c.superAdmin, true); assert.equal(c.canWrite, true); assert.equal(c.orgId, null);
  assert.deepEqual(c.roles, ['org_analyst', 'puviyan_admin']);
});
test('disabled, unknown and unassigned users fail closed', () => {
  for (const user of [null, { orgId: 'org1', roles: ['new_role'] }, { roles: ['org_admin'] },
    { orgId: 'org1', roles: ['org_admin'], status: 'suspended' }]) {
    assert.throws(() => contextFor('u1', user), error => error.status === 403);
  }
});
test('department-scoped users cannot access organisation-wide or another department project', () => {
  const c = contextFor('u1', { orgId: 'org1', roles: ['partner_staff'], scope: { type: 'departments', departmentIds: ['dept1'] } });
  assert.doesNotThrow(() => assertProject(c, project, true));
  assert.throws(() => assertProject(c, { ...project, departmentId: null }), /department/);
  assert.throws(() => assertProject(c, { ...project, orgId: 'org2' }), /organisation/);
});
test('GPS, photo timestamp and source validation reject invalid or stale evidence', () => {
  assert.equal(treeMetadata(tree()).species, 'Neem');
  for (const change of [{ latitude: 91 }, { longitude: '80' }, { accuracyMeters: 101 },
    { capturedAt: '2020-01-01' }, { photoSource: 'unknown' }, { eventId: '../another' }]) {
    assert.throws(() => treeMetadata({ ...tree(), ...change }), error => error.status === 400);
  }
  assert.throws(() => imageType(Buffer.from('<svg>bad</svg>')), /JPEG or PNG/);
});
test('API requires a valid active partner identity', async () => fixture(async ({ request }) => {
  for (const user of [null, 'expired', 'consumer-admin', 'disabled', 'missing']) {
    const res = await request('/me', user); assert.ok([401, 403].includes(res.status));
  }
}));
test('super admin without org can sign in and select organisations', async () => fixture(async ({ request }) => {
  const me = await request('/me', 'root'); assert.equal(me.status, 200);
  const data = await me.json(); assert.equal(data.orgId, null); assert.equal(data.canWrite, true);
  assert.equal((await request('/organisations', 'root')).status, 200);
  assert.equal((await request('/organisations', 'admin')).status, 403);
}));
test('cross-organisation and department access is denied for detail and uploads', async () => fixture(async ({ request }) => {
  for (const user of ['other', 'scoped']) {
    assert.equal((await request('/projects/p1', user)).status, 403);
    assert.equal((await request('/projects/p1/trees', user, upload())).status, 403);
  }
  assert.equal((await request('/projects?orgId=org2')).status, 403);
}));
test('analyst can read projects but cannot create projects, events or tree records', async () => fixture(async ({ request }) => {
  assert.equal((await request('/projects', 'reader')).status, 200);
  for (const [path, body] of [['/projects', { orgId: 'org1' }], ['/projects/p1/events', {}], ['/projects/p1/trees', upload()]]) {
    assert.equal((await request(path, 'reader', body)).status, 403);
  }
}));
test('projects preserve their scope and identity-derived owner', async () => fixture(async ({ request }) => {
  const res = await request('/projects', 'admin', { name: 'Plant a greener future', description: 'Native tree planting',
    locationName: 'Chennai', orgId: 'org1', scope: 'plant_trees', createdByUid: 'forged' });
  assert.equal(res.status, 201); const data = await res.json();
  assert.equal(data.project.createdByUid, 'admin'); assert.equal(data.project.orgId, 'org1');
}));
test('event dates and parent project are validated', async () => fixture(async ({ request }) => {
  const base = { name: 'Planting day', locationName: 'Park', startsAt: now, endsAt: now };
  assert.equal((await request('/projects/p1/events', 'admin', base)).status, 400);
  const res = await request('/projects/p1/events', 'admin', { ...base, endsAt: new Date(Date.now() + 3600000).toISOString() });
  assert.equal(res.status, 201); assert.equal((await res.json()).event.projectId, 'p1');
}));
test('tree photo saves privately with owner, coordinates and one record on retry', async () => fixture(async ({ request, db, files }) => {
  const data = tree();
  const first = await request('/projects/p1/trees', 'admin', upload(data)); assert.equal(first.status, 201);
  const second = await request('/projects/p1/trees', 'admin', upload(data)); assert.equal(second.status, 200);
  assert.equal(files.size, 1);
  const record = db.records.get(`partnerProjects/p1/trees/${data.recordId}`);
  assert.equal(record.createdByUid, 'admin'); assert.equal(record.verificationStatus, 'submitted');
  assert.equal(record.latitude, 12.9); assert.equal(record.photoUrl, undefined);
  const detail = await (await request('/projects/p1')).json();
  assert.match(detail.trees[0].photoUrl, /^https:\/\/private.example\//);
  assert.equal(detail.trees[0].storagePath, undefined);
  assert.equal(detail.trees[0].fingerprint, undefined);
}));
test('retry with changed content conflicts, missing event and wrong project scope fail', async () => fixture(async ({ request }) => {
  assert.equal((await request('/projects/p1/trees', 'admin', upload())).status, 201);
  assert.equal((await request('/projects/p1/trees', 'admin', upload({ ...tree(), species: 'Mango' }))).status, 409);
  assert.equal((await request('/projects/p1/trees', 'admin', upload({ ...tree(), eventId: 'missing' }))).status, 400);
  assert.equal((await request('/projects/p2/trees', 'admin', upload())).status, 400);
}));
test('role changes take effect on the next request', async () => fixture(async ({ request, db }) => {
  assert.equal((await request('/me')).status, 200);
  db.records.set('partnerUsers/admin', { orgId: 'org1', roles: ['org_admin'], status: 'disabled' });
  assert.equal((await request('/projects')).status, 403);
}));

test('legacy consumer and portal endpoints remain outside the new partner policy', async () => fixture(async ({ request, root }) => {
  assert.deepEqual(await (await fetch(`${root}/partner/me`)).json(), { legacyPartner: true });
  assert.deepEqual(await (await fetch(`${root}/points/balance`)).json(), { balance: 42 });
  assert.equal((await request('/me', 'consumer-admin')).status, 401);
  assert.equal((await request('/missing-route')).status, 404);
}));

test('tree storage configuration is optional at startup and fails closed when unset', () => {
  const { getPartnerTreeBucket } = require('../src/services/partner-tree-storage.service');
  const before = process.env.PARTNER_TREE_PHOTO_BUCKET;
  delete process.env.PARTNER_TREE_PHOTO_BUCKET;
  try { assert.throws(() => getPartnerTreeBucket(), error => error.status === 503); }
  finally { if (before === undefined) delete process.env.PARTNER_TREE_PHOTO_BUCKET; else process.env.PARTNER_TREE_PHOTO_BUCKET = before; }
});

test('real API entry point mounts the new router with its existing Firebase instances and API version', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const Module = require('node:module');
  const http = require('node:http');
  const db = memoryDb();
  let dataInitialised = false, partnerInitialised = false, verificationCount = 0;
  const sharedFirebase = {
    initializeFirebase() { dataInitialised = true; },
    initializePartnerFirebase() { partnerInitialised = true; },
    getFirestore() { assert.equal(dataInitialised, true); return db; },
    getPartnerAuth() { assert.equal(partnerInitialised, true); return {
      async verifyIdToken(token, revoked) { assert.equal(revoked, true); verificationCount++; return { uid: token }; },
    }; },
  };
  function load(relative, overrides) {
    const filename = path.resolve(__dirname, relative);
    const mod = new Module(filename, module);
    mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
    const originalRequire = Module.createRequire(filename);
    mod.require = id => Object.hasOwn(overrides, id) ? overrides[id] : originalRequire(id);
    mod._compile(fs.readFileSync(filename, 'utf8'), filename);
    return mod.exports;
  }
  const migrated = load('../src/routes/partner-app.routes.js', { '../config/firebase.config': sharedFirebase });
  function isolatedExpress() {
    const app = express();
    // Import the real entry point without binding its deployment port.
    app.listen = () => ({});
    return app;
  }
  Object.assign(isolatedExpress, express);
  const overrides = {
    express: isolatedExpress,
    dotenv: { config() {} },
    morgan: () => (_req, _res, next) => next(),
    './config/firebase.config': sharedFirebase,
    './routes/partner-app.routes': migrated,
  };
  for (const name of ['rewards', 'rewards-management', 'redemption', 'partner', 'partner-portal', 'points',
    'admin', 'upload', 'signup', 'organization', 'user-profile']) {
    const router = express.Router();
    if (name === 'points') router.get('/balance', (_req, res) => res.json({ legacyConsumer: true }));
    if (name === 'partner-portal') router.get('/me', (_req, res) => res.json({ legacyPartner: true }));
    overrides[`./routes/${name}.routes`] = router;
  }
  const previousVersion = process.env.API_VERSION;
  process.env.API_VERSION = 'v-test';
  let server;
  try {
    const app = load('../src/index.js', overrides);
    server = http.createServer(app).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v-test`;
    const response = await fetch(`${base}/partner-app/me`, { headers: { Authorization: 'Bearer admin' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).uid, 'admin');
    assert.equal(verificationCount, 1);
    assert.deepEqual(await (await fetch(`${base}/points/balance`)).json(), { legacyConsumer: true });
    assert.deepEqual(await (await fetch(`${base}/partner/me`)).json(), { legacyPartner: true });
  } finally {
    if (previousVersion === undefined) delete process.env.API_VERSION; else process.env.API_VERSION = previousVersion;
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});
