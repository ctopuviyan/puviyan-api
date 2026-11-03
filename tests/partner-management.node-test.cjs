const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.RATE_LIMIT_MAX_REQUESTS = '10000';
const {
  createPartnerManagement,
  canManage,
} = require('../src/services/partner-management.service');
const { contextFor } = require('../src/services/partner-project-policy');
const { createPartnerAppRouter } = require('../src/routes/partner-app.routes');
function store() {
  const data = new Map([
    [
      'partnerUsers/root',
      {
        roles: ['puviyan_admin'],
        email: 'root@example.invalid',
        status: 'active',
      },
    ],
    [
      'partnerUsers/admin',
      {
        orgId: 'orgA',
        roles: ['org_admin'],
        email: 'admin@example.invalid',
        status: 'active',
      },
    ],
    [
      'partnerUsers/legacy',
      { orgId: 'orgA', role: 'partner_admin', email: 'legacy@example.invalid' },
    ],
    [
      'partnerUsers/scoped',
      {
        orgId: 'orgA',
        roles: ['org_admin'],
        scope: { type: 'departments', departmentIds: ['dept1'] },
      },
    ],
    [
      'partnerUsers/reader',
      {
        orgId: 'orgA',
        roles: ['org_analyst'],
        email: 'reader@example.invalid',
      },
    ],
    [
      'partnerUsers/target',
      {
        orgId: 'orgA',
        roles: ['partner_staff'],
        scope: { type: 'departments', departmentIds: ['dept1'] },
        email: 'target@example.invalid',
        name: 'Target',
      },
    ],
    [
      'partnerUsers/other',
      { orgId: 'orgB', roles: ['org_admin'], email: 'other@example.invalid' },
    ],
    ['organizations/orgA', { name: 'Organisation A', status: 'active' }],
    ['organizations/orgB', { name: 'Organisation B', status: 'active' }],
    ['organizations/orgA/departments/dept1', { name: 'Operations' }],
    ['organizations/orgA/departments/dept2', { name: 'Research' }],
  ]);
  let n = 0,
    queue = Promise.resolve();
  function snapshot(ref) {
    return {
      id: ref.id,
      ref,
      exists: data.has(ref.path),
      data: () => data.get(ref.path),
    };
  }
  function ref(path) {
    return {
      path,
      id: path.split('/').pop(),
      get: async () => snapshot(ref(path)),
      set: async (v, options) =>
        data.set(path, options?.merge ? { ...data.get(path), ...v } : v),
      update: async (v) => {
        assert.ok(data.has(path));
        data.set(path, { ...data.get(path), ...v });
      },
      delete: async () => data.delete(path),
      collection: (name) => collection(`${path}/${name}`),
    };
  }
  function collection(path, filters = [], max = Infinity) {
    return {
      doc: (id = `generated${++n}`) => ref(`${path}/${id}`),
      where: (k, _op, v) => collection(path, [...filters, [k, v]], max),
      limit: (v) => collection(path, filters, v),
      get: async () => {
        const docs = [...data]
          .filter(
            ([p, d]) =>
              p.startsWith(path + '/') &&
              p.split('/').length === path.split('/').length + 1 &&
              filters.every(([k, v]) => d[k] === v)
          )
          .slice(0, max)
          .map(([p]) => snapshot(ref(p)));
        return { docs, empty: docs.length === 0 };
      },
      add: async (v) => {
        const r = ref(`${path}/generated${++n}`);
        await r.set(v);
        return r;
      },
    };
  }
  const db = {
    collection,
    data,
    runTransaction(fn) {
      const next = queue.then(async () => {
        const writes = [];
        const tx = {
          get: (r) => r.get(),
          set: (r, v, o) => writes.push(() => r.set(v, o)),
          update: (r, v) => writes.push(() => r.update(v)),
          create: (r, v) => {
            if (data.has(r.path)) throw Error('already exists');
            writes.push(() => r.set(v));
          },
        };
        const result = await fn(tx);
        for (const w of writes) await w();
        return result;
      });
      queue = next.catch(() => {});
      return next;
    },
  };
  const identities = new Map(
    [...data]
      .filter(([p]) => p.startsWith('partnerUsers/'))
      .map(([p, d]) => [
        p.split('/')[1],
        {
          uid: p.split('/')[1],
          email: d.email || p.split('/')[1] + '@example.invalid',
          displayName: d.name || p.split('/')[1],
          providerData: [{ providerId: 'password' }],
          customClaims: { external: 'keep' },
        },
      ])
  );
  identities.set('newbie', {
    uid: 'newbie',
    email: 'newbie@example.invalid',
    providerData: [{ providerId: 'password' }],
  });
  const revoked = [];
  const auth = {
    getUser: async (uid) => {
      if (!identities.has(uid)) throw Error('missing auth user');
      return identities.get(uid);
    },
    updateUser: async (uid, v) => {
      const old = await auth.getUser(uid);
      identities.set(uid, { ...old, ...v });
      return identities.get(uid);
    },
    setCustomUserClaims: async (uid, c) => {
      const u = await auth.getUser(uid);
      u.customClaims = c;
    },
    revokeRefreshTokens: async (uid) => revoked.push(uid),
    verifyIdToken: async (token, check) => {
      assert.equal(check, true);
      if (
        token === 'consumer-admin' ||
        !identities.has(token) ||
        (await auth.getUser(token)).disabled
      )
        throw Error('invalid');
      const u = await auth.getUser(token);
      return { uid: u.uid, email: u.email };
    },
  };
  const sent = [];
  const svc = createPartnerManagement({
    db,
    auth,
    portalUrl: 'https://partner.example.test',
    sendInvitation: async (d) => {
      sent.push(d);
      return { success: true };
    },
  });
  const c = (uid) => contextFor(uid, data.get('partnerUsers/' + uid));
  return { db, auth, svc, c, identities, sent, revoked };
}
const rejects = (p, status) => assert.rejects(p, (e) => e.status === status);
const grant = (roles = ['org_analyst']) => ({
  email: 'newbie@example.invalid',
  name: 'New partner',
  orgId: 'orgA',
  roles,
  scope: { type: 'org' },
  sendEmail: false,
});
function token(result) {
  return new URL(result.signupUrl).searchParams.get('token');
}
async function userBody(f, uid, extra = {}) {
  return {
    ...(await f.svc.listUsers(f.c('root'))).users.find((u) => u.uid === uid),
    ...extra,
  };
}

test('only full-organisation admins manage users; legacy admin role is accepted', async () => {
  const f = store();
  assert.equal(canManage(f.c('legacy')), true);
  assert.equal(canManage(f.c('scoped')), false);
  await rejects(f.svc.listUsers(f.c('reader')), 403);
  await rejects(f.svc.listUsers(f.c('scoped')), 403);
  await rejects(f.svc.listUsers(f.c('admin'), 'orgB'), 403);
  const all = await f.svc.listUsers(f.c('root'));
  assert.ok(all.users.some((u) => u.uid === 'root' && u.orgId === null));
});
test('role edits preserve multiple roles, department scope, legacy mirror and other custom claims', async () => {
  const f = store();
  const body = await userBody(f, 'target', {
    roles: ['org_analyst', 'partner_staff'],
    scope: { type: 'departments', departmentIds: ['dept2'] },
  });
  const r = await f.svc.updateUser(f.c('admin'), 'target', body);
  assert.deepEqual(r.user.roles, ['org_analyst', 'partner_staff']);
  assert.equal(f.db.data.get('partnerUsers/target').role, 'org_analyst');
  assert.deepEqual(r.user.scope.departmentIds, ['dept2']);
  assert.deepEqual(f.db.data.get('partner_users/target').roles, r.user.roles);
  assert.equal(f.identities.get('target').customClaims.external, 'keep');
  assert.ok(
    [...f.db.data.keys()].some((p) => p.startsWith('partnerUserAudit/'))
  );
});
test('org admins cannot edit other orgs, super admins, their own access, or grant super-admin roles', async () => {
  const f = store();
  await rejects(
    f.svc.updateUser(f.c('admin'), 'admin', await userBody(f, 'admin')),
    403
  );
  await rejects(
    f.svc.updateUser(f.c('admin'), 'other', await userBody(f, 'other')),
    403
  );
  await rejects(
    f.svc.updateUser(
      f.c('admin'),
      'target',
      await userBody(f, 'target', { roles: ['puviyan_admin'] })
    ),
    403
  );
  await rejects(
    f.svc.updateUser(
      f.c('admin'),
      'root',
      await userBody(f, 'root', { orgId: 'orgA' })
    ),
    403
  );
});
test('stale edits and changed actor permissions fail before updating users', async () => {
  const f = store();
  await rejects(
    f.svc.updateUser(
      f.c('admin'),
      'target',
      await userBody(f, 'target', { version: 'old' })
    ),
    409
  );
  const stale = f.c('admin');
  f.db.data.set('partnerUsers/admin', {
    orgId: 'orgA',
    roles: ['org_analyst'],
  });
  await rejects(
    f.svc.updateUser(stale, 'target', await userBody(f, 'target')),
    403
  );
  assert.deepEqual(f.db.data.get('partnerUsers/target').roles, [
    'partner_staff',
  ]);
});
test('suspension disables sign-in and revokes sessions, activation restores sign-in', async () => {
  const f = store();
  await f.svc.updateUser(
    f.c('admin'),
    'target',
    await userBody(f, 'target', { status: 'inactive' })
  );
  assert.equal(f.identities.get('target').disabled, true);
  assert.deepEqual(f.revoked, ['target']);
  await assert.rejects(f.auth.verifyIdToken('target', true));
  await f.svc.updateUser(
    f.c('admin'),
    'target',
    await userBody(f, 'target', { status: 'active' })
  );
  assert.equal(f.identities.get('target').disabled, false);
});
test('profile changes synchronize shared records but cannot change roles or bootstrap membership', async () => {
  const f = store();
  await f.svc.profile(
    { uid: 'target' },
    {
      displayName: 'Updated name',
      photoURL: 'https://images.example.test/p.png',
    }
  );
  assert.equal(f.identities.get('target').displayName, 'Updated name');
  assert.equal(f.db.data.get('partnerUsers/target').name, 'Updated name');
  assert.equal(
    f.db.data.get('partner_users/target').photoURL,
    'https://images.example.test/p.png'
  );
  assert.deepEqual(f.db.data.get('partnerUsers/target').roles, [
    'partner_staff',
  ]);
  await rejects(
    f.svc.profile(
      { uid: 'target' },
      { displayName: 'No', roles: ['puviyan_admin'] }
    ),
    400
  );
  await f.svc.profile({ uid: 'newbie' }, { displayName: 'Newbie' });
  assert.equal(f.db.data.has('partnerUsers/newbie'), false);
});
test('invitations store only token hashes, support multiple roles and email is opt-in', async () => {
  const f = store();
  const r = await f.svc.invite(
    f.c('admin'),
    grant(['org_analyst', 'partner_staff'])
  );
  const link = f.db.data.get('signupLinks/' + r.id);
  assert.equal(link.token, undefined);
  assert.equal(link.tokenHash.length, 64);
  assert.equal(f.sent.length, 0);
  const result = await f.svc.complete(
    { uid: 'newbie', email: 'newbie@example.invalid' },
    token(r)
  );
  assert.deepEqual(result.user.roles, ['org_analyst', 'partner_staff']);
  assert.equal(f.db.data.get('signupLinks/' + r.id).used, true);
  await rejects(
    f.svc.complete(
      { uid: 'newbie', email: 'newbie@example.invalid' },
      token(r)
    ),
    409
  );
});
test('invitation completion preserves existing roles/scope and refuses mismatched email or organisation', async () => {
  const f = store();
  const r = await f.svc.invite(f.c('admin'), {
    ...grant(),
    email: 'target@example.invalid',
  });
  await rejects(
    f.svc.complete({ uid: 'other', email: 'other@example.invalid' }, token(r)),
    403
  );
  const result = await f.svc.complete(
    { uid: 'target', email: 'target@example.invalid' },
    token(r)
  );
  assert.deepEqual(result.user.roles, ['org_analyst', 'partner_staff']);
  assert.equal(result.user.scope.type, 'departments');
  const r2 = await f.svc.invite(f.c('root'), {
    ...grant(),
    email: 'other@example.invalid',
  });
  await rejects(
    f.svc.complete({ uid: 'other', email: 'other@example.invalid' }, token(r2)),
    409
  );
});
test('expired and revoked invitations cannot onboard users; renew invalidates old token', async () => {
  const f = store();
  const r = await f.svc.invite(f.c('admin'), grant());
  f.db.data.get('signupLinks/' + r.id).expiresAt = new Date(0);
  await rejects(
    f.svc.complete(
      { uid: 'newbie', email: 'newbie@example.invalid' },
      token(r)
    ),
    409
  );
  const renewed = await f.svc.changeInvite(f.c('admin'), r.id, {});
  await rejects(
    f.svc.complete(
      { uid: 'newbie', email: 'newbie@example.invalid' },
      token(r)
    ),
    404
  );
  await f.svc.changeInvite(f.c('admin'), r.id, { revoke: true });
  await rejects(
    f.svc.complete(
      { uid: 'newbie', email: 'newbie@example.invalid' },
      token(renewed)
    ),
    409
  );
});
test('concurrent invitation completion consumes a link once', async () => {
  const f = store();
  const r = await f.svc.invite(f.c('admin'), grant());
  const outcomes = await Promise.allSettled([
    f.svc.complete(
      { uid: 'newbie', email: 'newbie@example.invalid' },
      token(r)
    ),
    f.svc.complete(
      { uid: 'newbie', email: 'newbie@example.invalid' },
      token(r)
    ),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
});
test('request approvals enforce org ownership and atomically create multi-role links', async () => {
  const f = store();
  await f.db.collection('signupRequests').doc('r1').set({
    email: 'newbie@example.invalid',
    name: 'Newbie',
    assignedOrgId: 'orgB',
    status: 'pending',
  });
  await rejects(
    f.svc.review(f.c('admin'), 'r1', {
      decision: 'approve',
      roles: ['org_analyst'],
      orgId: 'orgA',
    }),
    403
  );
  f.db.data.get('signupRequests/r1').assignedOrgId = 'orgA';
  const r = await f.svc.review(f.c('admin'), 'r1', {
    decision: 'approve',
    roles: ['org_analyst', 'partner_staff'],
    orgId: 'orgA',
    sendEmail: false,
  });
  assert.ok(r.signupUrl);
  assert.equal(f.db.data.get('signupRequests/r1').status, 'approved');
  await rejects(
    f.svc.review(f.c('admin'), 'r1', {
      decision: 'approve',
      roles: ['org_analyst'],
      orgId: 'orgA',
    }),
    409
  );
});
test('requests for new organisations are reviewed by super admins and rejections retain a reason', async () => {
  const f = store();
  await f.db.collection('signupRequests').doc('r1').set({
    email: 'newbie@example.invalid',
    name: 'Newbie',
    status: 'pending',
    assignedOrgId: null,
  });
  await rejects(
    f.svc.review(f.c('admin'), 'r1', { decision: 'reject', reason: 'No' }),
    400
  );
  await f.svc.review(f.c('root'), 'r1', {
    decision: 'reject',
    reason: 'Please provide organisation details',
  });
  assert.equal(
    f.db.data.get('signupRequests/r1').rejectionReason,
    'Please provide organisation details'
  );
});
test('additional-role requests preserve existing roles and cannot be self-approved', async () => {
  const f = store();
  const r = await f.svc.requestRoles(
    f.c('target'),
    { uid: 'target', email: 'target@example.invalid' },
    { roles: ['org_analyst'], reason: 'Reporting' }
  );
  await f.svc.review(f.c('admin'), r.id, {
    decision: 'approve',
    roles: ['org_analyst'],
    orgId: 'orgA',
  });
  assert.deepEqual(f.db.data.get('partnerUsers/target').roles, [
    'org_analyst',
    'partner_staff',
  ]);
  const own = await f.svc.requestRoles(
    f.c('admin'),
    { uid: 'admin', email: 'admin@example.invalid' },
    { roles: ['partner_staff'], reason: 'Need staff role' }
  );
  await rejects(
    f.svc.review(f.c('admin'), own.id, {
      decision: 'approve',
      roles: ['partner_staff'],
      orgId: 'orgA',
    }),
    403
  );
});
test('organisation creation is super-admin-only and profile edits cannot cross orgs', async () => {
  const f = store();
  await rejects(
    f.svc.saveOrganisation(f.c('admin'), null, { name: 'New' }),
    403
  );
  await rejects(
    f.svc.saveOrganisation(f.c('admin'), 'orgB', { name: 'Wrong' }),
    403
  );
  const r = await f.svc.saveOrganisation(f.c('root'), null, {
    name: 'New',
    logoUrl: null,
  });
  assert.equal(f.db.data.get('organizations/' + r.id).status, 'active');
  const orgs = await f.svc.organisations(f.c('admin'));
  assert.equal(orgs.organisations.length, 1);
  assert.equal(orgs.organisations[0].departments.length, 2);
});
test('email transport failure leaves a valid invitation with a copyable link', async () => {
  const f = store();
  const svc = createPartnerManagement({
    db: f.db,
    auth: f.auth,
    portalUrl: 'https://portal.example.test',
    sendInvitation: async () => {
      throw Error('SMTP down');
    },
  });
  const r = await svc.invite(f.c('admin'), { ...grant(), sendEmail: true });
  assert.equal(r.emailSent, false);
  assert.ok(r.signupUrl);
  assert.equal(f.db.data.get('signupLinks/' + r.id).used, false);
});
test('HTTP account routes serve unonboarded identities while project/management routes stay protected', async () => {
  const f = store();
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/partner-app',
    createPartnerAppRouter({
      db: f.db,
      auth: f.auth,
      managementOptions: { portalUrl: 'https://portal.example.test' },
      logger: { error() {} },
    })
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/partner-app`;
  async function get(path, user) {
    return fetch(base + path, { headers: { Authorization: 'Bearer ' + user } });
  }
  try {
    assert.equal((await get('/account', 'newbie')).status, 200);
    assert.equal((await get('/projects', 'newbie')).status, 403);
    assert.equal((await get('/management/users', 'reader')).status, 403);
    assert.equal(
      (await get('/management/users', 'consumer-admin')).status,
      401
    );
    assert.equal((await get('/management/users', 'admin')).status, 200);
    assert.equal((await get('/account', 'admin')).status, 200);
    await f.db
      .collection('signupRequests')
      .doc('privateA')
      .set({ email: 'newbie@example.invalid', name: 'Own', status: 'pending' });
    await f.db.collection('signupRequests').doc('privateB').set({
      email: 'target@example.invalid',
      name: 'Other',
      status: 'pending',
    });
    const own = await (await get('/account/requests', 'newbie')).json();
    assert.equal(own.requests.length, 1);
    assert.equal(own.requests[0].name, 'Own');
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

function portalService(f) {
  const fs = require('node:fs'),
    path = require('node:path'),
    Module = require('node:module');
  const filename = path.resolve(__dirname, '../src/services/signup.service.js');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const nativeRequire = Module.createRequire(filename);
  mod.require = (name) =>
    name === '../config/firebase.config'
      ? {
          getFirestore: () => f.db,
          getPartnerAuth: () => f.auth,
          FieldValue: { serverTimestamp: () => new Date() },
        }
      : name === './partner-management.service'
        ? {
            createPartnerManagement: (options) =>
              createPartnerManagement({
                ...options,
                portalUrl: 'https://portal.example.test',
                sendInvitation: async () => ({ success: true }),
                sendRejection: async () => ({ success: true }),
              }),
          }
        : nativeRequire(name);
  mod._compile(fs.readFileSync(filename, 'utf8'), filename);
  return mod.exports;
}
test('existing portal invitation facade shares multi-role completion and protects org scope', async () => {
  const f = store(),
    portal = portalService(f);
  await assert.rejects(
    portal.generateSignupLink({
      createdBy: 'admin',
      orgId: 'orgB',
      email: 'newbie@example.invalid',
      name: 'Newbie',
      role: 'org_analyst',
    }),
    (e) => e.statusCode === 403
  );
  const link = await f.svc.invite(f.c('admin'), {
    ...grant(['org_analyst', 'partner_staff']),
    email: 'target@example.invalid',
  });
  const info = await portal.validateSignupToken({ token: token(link) });
  assert.deepEqual(info.roles, ['org_analyst', 'partner_staff']);
  const completed = await portal.completeSignup({
    uid: 'target',
    email: 'target@example.invalid',
    token: token(link),
  });
  assert.deepEqual(completed.user.roles, ['org_analyst', 'partner_staff']);
  assert.equal(completed.user.scope.type, 'departments');
});
test('existing portal approvals cannot review another organisation or reuse a request', async () => {
  const f = store(),
    portal = portalService(f);
  await f.db.collection('signupRequests').doc('portalRequest').set({
    email: 'newbie@example.invalid',
    name: 'Newbie',
    assignedOrgId: 'orgB',
    status: 'pending',
  });
  await assert.rejects(
    portal.approveSignupRequest({
      requestId: 'portalRequest',
      orgId: 'orgA',
      role: 'org_analyst',
      approvedBy: 'admin',
    }),
    (e) => e.statusCode === 403
  );
  const result = await portal.approveSignupRequest({
    requestId: 'portalRequest',
    orgId: 'orgB',
    role: 'org_analyst',
    approvedBy: 'root',
  });
  assert.ok(result.signupLinkId);
  assert.ok(result.token);
  await assert.rejects(
    portal.rejectSignupRequest({
      requestId: 'portalRequest',
      reason: 'Too late',
      rejectedBy: 'root',
    }),
    (e) => e.statusCode === 409
  );
});
test('legacy portal validation rejects renewed/revoked links and public role requests reject super-admin grants', async () => {
  const f = store(),
    portal = portalService(f);
  const link = await f.svc.invite(f.c('admin'), grant());
  await f.svc.changeInvite(f.c('admin'), link.id, { revoke: true });
  await assert.rejects(
    portal.validateSignupToken({ token: token(link) }),
    (e) => e.statusCode === 400
  );
  await assert.rejects(
    portal.submitSignupRequest({
      email: 'newbie@example.invalid',
      name: 'Newbie',
      organizationName: 'A',
      requestedRoles: ['puviyan_admin'],
    }),
    (e) => e.statusCode === 400
  );
});

test('self-invitations cannot bypass the own-access guard', async () => {
  const f = store();
  await rejects(
    f.svc.invite(f.c('admin'), { ...grant(), email: 'admin@example.invalid' }),
    403
  );
});
test('pending invitations require an active authorised issuer; another admin can renew them', async () => {
  const f = store();
  const original = await f.svc.invite(f.c('admin'), grant());
  f.db.data.get('partnerUsers/admin').roles = ['org_analyst'];
  await rejects(
    f.svc.complete(
      { uid: 'newbie', email: 'newbie@example.invalid' },
      token(original)
    ),
    403
  );
  const renewed = await f.svc.changeInvite(f.c('root'), original.id, {});
  assert.equal(f.db.data.get('signupLinks/' + original.id).createdBy, 'root');
  const accepted = await f.svc.complete(
    { uid: 'newbie', email: 'newbie@example.invalid' },
    token(renewed)
  );
  assert.deepEqual(accepted.user.roles, ['org_analyst']);
});
test('unassigned legacy accounts receive only the newly approved organisation roles', async () => {
  const f = store();
  f.db.data.set('partnerUsers/newbie', {
    email: 'newbie@example.invalid',
    name: 'Legacy unassigned',
    roles: ['org_admin'],
    scope: { type: 'org' },
  });
  const link = await f.svc.invite(f.c('admin'), grant(['partner_staff']));
  const accepted = await f.svc.complete(
    { uid: 'newbie', email: 'newbie@example.invalid' },
    token(link)
  );
  assert.deepEqual(accepted.user.roles, ['partner_staff']);
  assert.equal(accepted.user.orgId, 'orgA');
});
