const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.RATE_LIMIT_MAX_REQUESTS = '10000';
const { store } = require('./helpers/partner-fixture.cjs');
const {
  createSustainabilityAccounts,
  ACTION_OWNER,
  SERVICE_PROVIDER,
} = require('../src/services/sustainability-accounts.service');
const { createPartnerAppRouter } = require('../src/routes/partner-app.routes');
const { contextFor } = require('../src/services/partner-project-policy');
const input = {
  firstName: 'Asha',
  lastName: 'Kumar',
  title: 'Sustainability lead',
  organisationName: 'Green Earth Ltd',
  accountType: ACTION_OWNER,
};
const profile = {
  firstName: 'Ravi',
  lastName: 'Das',
  title: 'Field coordinator',
};
const reject = (p, status) => assert.rejects(p, (e) => e.status === status);
function fixture(options = {}) {
  const f = store();
  let date = new Date('2026-11-05T12:00:00Z');
  f.sent = [];
  f.v2 = createSustainabilityAccounts({
    db: f.db,
    auth: f.auth,
    signupUrl: 'https://partner.example.test/new-signup',
    now: () => date,
    sendInvitation: async (d) => {
      f.sent.push(d);
      return { success: true };
    },
    ...options,
  });
  f.who = (uid) => ({
    uid,
    email: f.identities.get(uid).email,
    signInProvider: f.identities.get(uid).signInProvider || 'password',
  });
  f.add = (uid, email = uid + '@example.invalid') => {
    f.identities.set(uid, {
      uid,
      email,
      providerData: [{ providerId: 'password' }],
    });
    return f.who(uid);
  };
  f.expire = () => {
    date = new Date(date.getTime() + 8 * 86400000);
  };
  f.register = (uid = 'newbie', body = input) =>
    f.v2.register(f.who(uid), body);
  f.token = (r) => new URL(r.signupUrl).searchParams.get('token');
  return f;
}
async function enrolled(f, uid = 'invitee', role = 'org_analyst') {
  f.add(uid);
  const link = await f.v2.invite(f.who('newbie'), {
    email: f.who(uid).email,
    role,
  });
  return f.v2.acceptInvitation(f.who(uid), {
    token: f.token(link),
    ...profile,
  });
}
test('owner signup creates a unique organisation, profile and exact owner role atomically', async () => {
  const f = fixture();
  const r = await f.register();
  assert.equal(r.created, true);
  assert.match(r.organisation.id, /^green-earth-ltd-[a-f0-9]{32}$/);
  assert.equal(r.user.role, ACTION_OWNER);
  assert.deepEqual(r.user.roles, [ACTION_OWNER]);
  assert.equal(r.user.title, input.title);
  assert.deepEqual(
    f.db.data.get('organizations/' + r.organisation.id).ownerUids,
    ['newbie']
  );
  assert.equal(f.db.data.get('partner_users/newbie').orgId, r.organisation.id);
  assert.equal((await f.v2.account(f.who('newbie'))).canManageMembers, true);
  assert.equal(f.db.data.get('partnerUsers/newbie').password, undefined);
});
test('same organisation name gets different IDs; retries and concurrent signup do not duplicate accounts', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.register(), f.register()]);
  assert.equal(a.organisation.id, b.organisation.id);
  assert.deepEqual([a.created, b.created].sort(), [false, true]);
  f.add('second');
  const c = await f.register('second');
  assert.notEqual(c.organisation.id, a.organisation.id);
  await reject(
    f.register('newbie', { ...input, organisationName: 'Another company' }),
    409
  );
});
test('organisation ID collisions fail without replacing an account or organisation', async () => {
  const f = fixture({ randomId: () => 'fixed-id' });
  await f.register();
  f.add('second');
  await reject(f.register('second'), 409);
  assert.equal(f.db.data.has('partnerUsers/second'), false);
});
test('service provider can self-register and write projects but cannot invite or manage members', async () => {
  const f = fixture();
  const r = await f.register('newbie', {
    ...input,
    accountType: SERVICE_PROVIDER,
  });
  assert.equal(r.user.role, SERVICE_PROVIDER);
  assert.equal((await f.v2.account(f.who('newbie'))).canManageMembers, false);
  assert.equal(
    contextFor('newbie', f.db.data.get('partnerUsers/newbie')).canWrite,
    true
  );
  await reject(
    f.v2.invite(f.who('newbie'), {
      email: 'new@example.invalid',
      role: 'org_admin',
    }),
    403
  );
  await reject(f.v2.listMembers(f.who('newbie')), 403);
});
test('public registration rejects admin, analyst, injected org IDs, roles, password and missing profile fields', async () => {
  const f = fixture();
  for (const accountType of ['org_admin', 'org_analyst', 'puviyan_admin'])
    await reject(f.register('newbie', { ...input, accountType }), 400);
  for (const extra of [
    { orgId: 'orgA' },
    { role: 'org_admin' },
    { roles: ['org_admin'] },
    { password: 'not-for-the-api' },
  ])
    await reject(f.register('newbie', { ...input, ...extra }), 400);
  for (const key of ['firstName', 'lastName', 'title', 'organisationName'])
    await reject(f.register('newbie', { ...input, [key]: '' }), 400);
  assert.equal(f.db.data.has('partnerUsers/newbie'), false);
});
test('Google, custom-token, linked Google/password, disabled and spoofed-email identities are rejected', async () => {
  const f = fixture();
  for (const signInProvider of ['google.com', 'custom', undefined])
    await reject(
      f.v2.register({ ...f.who('newbie'), signInProvider }, input),
      403
    );
  await reject(
    f.v2.register(
      { ...f.who('newbie'), email: 'someone@example.invalid' },
      input
    ),
    403
  );
  f.identities.get('newbie').providerData.push({ providerId: 'google.com' });
  await reject(f.register(), 403);
  f.identities.get('newbie').providerData = [{ providerId: 'password' }];
  f.identities.get('newbie').disabled = true;
  await reject(f.register(), 403);
});
test('invitation sends email, stores only a hash and grants exactly one org-scoped admin or analyst role', async () => {
  const f = fixture();
  await f.register();
  f.add('invitee');
  const r = await f.v2.invite(f.who('newbie'), {
    email: 'INVITEE@example.invalid',
    role: 'org_admin',
  });
  assert.equal(r.emailSent, true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, 'invitee@example.invalid');
  const saved = f.db.data.get('partnerV2Invitations/' + r.id);
  assert.equal(saved.token, undefined);
  assert.equal(saved.signupUrl, undefined);
  assert.notEqual(saved.tokenHash, f.token(r));
  const valid = await f.v2.validateInvitation(f.token(r));
  assert.equal(valid.role, 'org_admin');
  const accepted = await f.v2.acceptInvitation(f.who('invitee'), {
    ...profile,
    token: f.token(r),
  });
  assert.equal(accepted.user.orgId, valid.organisation.id);
  assert.deepEqual(accepted.user.roles, ['org_admin']);
  assert.equal((await f.v2.account(f.who('invitee'))).canManageMembers, false);
});
test('admin and analyst memberships cannot be created, escalated or moved without an invitation', async () => {
  const f = fixture();
  await f.register();
  const m = await enrolled(f, 'analyst');
  f.add('uninvited');
  await reject(f.v2.account(f.who('uninvited')), 403);
  for (const role of [
    ACTION_OWNER,
    SERVICE_PROVIDER,
    'puviyan_admin',
    'partner_admin',
  ])
    await reject(
      f.v2.invite(f.who('newbie'), { email: 'x@example.invalid', role }),
      400
    );
  await reject(
    f.v2.invite(f.who('newbie'), {
      email: f.who('newbie').email,
      role: 'org_admin',
    }),
    403
  );
  for (const uid of ['analyst']) {
    await reject(
      f.v2.invite(f.who(uid), {
        email: 'x@example.invalid',
        role: 'org_analyst',
      }),
      403
    );
    await reject(
      f.v2.updateMember(f.who(uid), 'newbie', {
        role: 'org_admin',
        version: 1,
      }),
      403
    );
  }
  await reject(
    f.v2.updateMember(f.who('newbie'), 'analyst', {
      role: ACTION_OWNER,
      version: m.user.version,
    }),
    400
  );
  await reject(
    f.v2.updateMember(f.who('newbie'), 'analyst', {
      role: 'org_admin',
      version: 1,
      orgId: 'orgB',
    }),
    400
  );
});
test('action owner can swap admin and analyst with optimistic concurrency; admins cannot manage users', async () => {
  const f = fixture();
  await f.register();
  await enrolled(f, 'member');
  const a = await f.v2.updateMember(f.who('newbie'), 'member', {
    role: 'org_admin',
    version: 1,
  });
  assert.equal(a.user.role, 'org_admin');
  await reject(f.v2.listMembers(f.who('member')), 403);
  await reject(
    f.v2.updateMember(f.who('newbie'), 'member', {
      role: 'org_analyst',
      version: 1,
    }),
    409
  );
  const b = await f.v2.updateMember(f.who('newbie'), 'member', {
    role: 'org_analyst',
    version: 2,
  });
  assert.equal(b.user.role, 'org_analyst');
  const members = await f.v2.listMembers(f.who('newbie'));
  assert.deepEqual(members.grantableRoles, ['org_admin', 'org_analyst']);
});
test('cross-org role edits, invitations and accepting an invite into a second organisation are denied', async () => {
  const f = fixture();
  await f.register();
  f.add('otherOwner');
  const other = await f.register('otherOwner', {
    ...input,
    organisationName: 'Another organisation',
  });
  await reject(
    f.v2.updateMember(f.who('newbie'), 'otherOwner', {
      role: 'org_admin',
      version: 1,
    }),
    403
  );
  const link = await f.v2.invite(f.who('newbie'), {
    email: f.who('otherOwner').email,
    role: 'org_analyst',
  });
  await reject(
    f.v2.acceptInvitation(f.who('otherOwner'), {
      ...profile,
      token: f.token(link),
    }),
    409
  );
  assert.equal(
    f.db.data.get('partnerUsers/otherOwner').orgId,
    other.organisation.id
  );
  await reject(f.v2.changeInvitation(f.who('otherOwner'), link.id, true), 403);
});
test('wrong email, injected accept roles and replayed or concurrent invitation use fail closed', async () => {
  const f = fixture();
  await f.register();
  f.add('invitee');
  f.add('wrong');
  const link = await f.v2.invite(f.who('newbie'), {
    email: f.who('invitee').email,
    role: 'org_analyst',
  });
  await reject(
    f.v2.acceptInvitation(f.who('wrong'), { ...profile, token: f.token(link) }),
    403
  );
  await reject(
    f.v2.acceptInvitation(f.who('invitee'), {
      ...profile,
      token: f.token(link),
      role: 'org_admin',
    }),
    400
  );
  const result = await Promise.allSettled(
    [1, 2].map(() =>
      f.v2.acceptInvitation(f.who('invitee'), {
        ...profile,
        token: f.token(link),
      })
    )
  );
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(result.find((r) => r.status === 'rejected').reason.status, 409);
  await reject(f.v2.validateInvitation(f.token(link)), 409);
});
test('invitation expiry, renewal and revocation invalidate the previous token', async () => {
  const f = fixture();
  await f.register();
  const first = await f.v2.invite(f.who('newbie'), {
    email: 'pending@example.invalid',
    role: 'org_analyst',
  });
  f.expire();
  await reject(f.v2.validateInvitation(f.token(first)), 409);
  const second = await f.v2.changeInvitation(f.who('newbie'), first.id, false);
  await reject(f.v2.validateInvitation(f.token(first)), 404);
  assert.equal(
    (await f.v2.validateInvitation(f.token(second))).role,
    'org_analyst'
  );
  await f.v2.changeInvitation(f.who('newbie'), first.id, true);
  await reject(f.v2.validateInvitation(f.token(second)), 409);
  await reject(f.v2.changeInvitation(f.who('newbie'), first.id, false), 409);
});
test('concurrent duplicate invitations produce one email and one active link', async () => {
  const f = fixture();
  await f.register();
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      f.v2.invite(f.who('newbie'), {
        email: 'pending@example.invalid',
        role: 'org_admin',
      })
    )
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.status, 409);
  assert.equal(f.sent.length, 1);
});
test('SMTP failure preserves an invitation and renewal retries delivery; bad signup configuration fails before persistence', async () => {
  const f = fixture({
    sendInvitation: async () => {
      throw Error('smtp unavailable');
    },
  });
  await f.register();
  const link = await f.v2.invite(f.who('newbie'), {
    email: 'pending@example.invalid',
    role: 'org_analyst',
  });
  assert.equal(link.emailSent, false);
  assert.ok(link.signupUrl);
  const renewal = await f.v2.changeInvitation(f.who('newbie'), link.id, false);
  assert.equal(renewal.emailSent, false);
  const missing = fixture({ signupUrl: undefined });
  await missing.register();
  await reject(
    missing.v2.invite(missing.who('newbie'), {
      email: 'pending@example.invalid',
      role: 'org_admin',
    }),
    503
  );
  assert.equal(
    [...missing.db.data.keys()].filter((p) =>
      p.startsWith('partnerV2Invitations/')
    ).length,
    0
  );
});
test('the last active action owner cannot be demoted or suspended', async () => {
  const f = fixture();
  await f.register();
  await reject(
    f.v2.updateMember(f.who('newbie'), 'newbie', {
      role: 'org_admin',
      version: 1,
    }),
    409
  );
  await reject(
    f.v2.updateMember(f.who('newbie'), 'newbie', {
      status: 'inactive',
      version: 1,
    }),
    409
  );
  assert.equal(f.db.data.get('partnerUsers/newbie').role, ACTION_OWNER);
});
async function secondOwner(f) {
  const user = {
    ...f.db.data.get('partnerUsers/newbie'),
    email: 'coowner@example.invalid',
  };
  f.add('coowner');
  await f.db.collection('partnerUsers').doc('coowner').set(user);
  const org = f.db.data.get('organizations/' + user.orgId);
  org.ownerUids.push('coowner');
}
test('concurrent owner demotions serialize on the org and leave an active action owner', async () => {
  const f = fixture();
  await f.register();
  await secondOwner(f);
  const results = await Promise.allSettled(
    ['newbie', 'coowner'].map((uid) =>
      f.v2.updateMember(f.who(uid), uid, { role: 'org_analyst', version: 1 })
    )
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.status, 409);
  const org = f.db.data.get(
    'organizations/' + f.db.data.get('partnerUsers/newbie').orgId
  );
  assert.equal(org.ownerUids.length, 1);
  assert.equal(
    f.db.data.get('partnerUsers/' + org.ownerUids[0]).role,
    ACTION_OWNER
  );
});
test('an issuer losing ownership invalidates pending invitations; an active owner can renew them', async () => {
  const f = fixture();
  await f.register();
  await secondOwner(f);
  const link = await f.v2.invite(f.who('newbie'), {
    email: 'pending@example.invalid',
    role: 'org_analyst',
  });
  await f.v2.updateMember(f.who('coowner'), 'newbie', {
    role: 'org_admin',
    version: 1,
  });
  await reject(f.v2.validateInvitation(f.token(link)), 403);
  const fresh = await f.v2.changeInvitation(f.who('coowner'), link.id, false);
  assert.equal(
    (await f.v2.validateInvitation(f.token(fresh))).role,
    'org_analyst'
  );
});
test('profile edits preserve organisation, account type and roles', async () => {
  const f = fixture();
  await f.register();
  const r = await f.v2.profile(f.who('newbie'), {
    ...profile,
    photoURL: 'https://photos.example.test/profile.png',
  });
  assert.equal(r.user.firstName, profile.firstName);
  assert.equal(r.user.role, ACTION_OWNER);
  await reject(
    f.v2.profile(f.who('newbie'), { ...profile, orgId: 'orgB' }),
    400
  );
  await reject(
    f.v2.profile(f.who('newbie'), {
      ...profile,
      photoURL: 'javascript:alert(1)',
    }),
    400
  );
});
test('legacy management cannot edit v2 members or grant legacy invitations into v2 organisations', async () => {
  const f = fixture();
  const r = await f.register();
  await reject(
    f.svc.updateUser(f.c('root'), 'newbie', {
      roles: ['org_admin'],
      status: 'inactive',
      orgId: r.organisation.id,
      version: 1,
    }),
    403
  );
  await reject(
    f.svc.invite(f.c('root'), {
      email: 'x@example.invalid',
      name: 'X',
      orgId: r.organisation.id,
      roles: ['org_admin'],
    }),
    403
  );
  await reject(
    f.svc.saveOrganisation(f.c('root'), r.organisation.id, { name: 'Renamed' }),
    403
  );
  await reject(f.svc.listUsers(f.c('newbie')), 403);
  const legacyLink = await f.svc.invite(f.c('admin'), {
    email: f.who('newbie').email,
    name: 'X',
    orgId: 'orgA',
    roles: ['org_admin'],
  });
  await reject(f.svc.complete(f.who('newbie'), f.token(legacyLink)), 403);
});
test('HTTP routes enforce password auth, registration, invite-only access and existing project org boundaries', async () => {
  const f = fixture();
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/partner-app',
    createPartnerAppRouter({
      db: f.db,
      auth: f.auth,
      sustainabilityOptions: {
        signupUrl: 'https://partner.example.test/new-signup',
        sendInvitation: async () => ({ success: true }),
      },
      logger: { error() {} },
    })
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/partner-app`;
  const call = async (path, uid, body, method) => {
    const r = await fetch(base + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: {
        ...(uid ? { Authorization: 'Bearer ' + uid } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    assert.equal((await call('/v2/account')).status, 401);
    f.identities.get('newbie').signInProvider = 'google.com';
    assert.equal(
      (await call('/v2/registrations', 'newbie', input)).status,
      403
    );
    f.identities.get('newbie').signInProvider = 'password';
    const owner = await call('/v2/registrations', 'newbie', input);
    assert.equal(owner.status, 201);
    assert.equal(
      (await call('/v2/registrations', 'newbie', input)).status,
      200
    );
    const invite = await call('/v2/invitations', 'newbie', {
      email: 'ravi@example.invalid',
      role: 'org_admin',
    });
    assert.equal(invite.status, 201);
    const token = f.token(invite.data);
    const landing = await fetch(
      base + '/v2/join?token=' + encodeURIComponent(token)
    );
    assert.equal(landing.status, 200);
    assert.equal(landing.headers.get('cache-control'), 'no-store');
    assert.match(await landing.text(), /I have an invitation/);
    assert.equal(
      (await call('/v2/invitations/validate', null, { token })).status,
      200
    );
    f.add('ravi', 'ravi@example.invalid');
    assert.equal((await call('/v2/account', 'ravi')).status, 403);
    assert.equal(
      (await call('/v2/invitations/accept', 'ravi', { ...profile, token }))
        .status,
      201
    );
    assert.equal((await call('/v2/members', 'ravi')).status, 403);
    assert.equal((await call('/management/users', 'ravi')).status, 403);
    const project = {
      name: 'Plant trees',
      description: 'An org scoped project',
      locationName: 'Chennai',
      scope: 'plant_trees',
    };
    assert.equal(
      (await call('/projects', 'ravi', { ...project, orgId: 'orgA' })).status,
      403
    );
    const created = await call('/projects', 'ravi', project);
    assert.equal(created.status, 201);
    assert.equal(
      (await call('/projects/' + created.data.project.id, 'other')).status,
      403
    );
    f.identities.get('ravi').signInProvider = 'google.com';
    assert.equal((await call('/projects', 'ravi')).status, 403);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
function withFirebase(filename, f) {
  const fs = require('node:fs'),
    path = require('node:path'),
    Module = require('node:module');
  const file = path.resolve(__dirname, '../src/' + filename),
    mod = new Module(file, module);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  const native = Module.createRequire(file);
  mod.require = (name) =>
    name === '../config/firebase.config'
      ? {
          getFirestore: () => f.db,
          getPartnerAuth: () => f.auth,
          initializePartnerFirebase() {},
          getAuth: () => ({
            verifyIdToken: async () => {
              throw Error('not consumer');
            },
          }),
        }
      : native(name);
  mod._compile(fs.readFileSync(file, 'utf8'), file);
  return mod.exports;
}
test('legacy password and portal middleware block v2 access, permitting only password-authenticated profile uploads', async () => {
  const f = fixture();
  await f.register();
  const auth = withFirebase('middleware/auth.middleware.js', f),
    partner = withFirebase('middleware/partner-auth.middleware.js', f);
  async function check(middleware, uid, baseUrl, path) {
    let status = 200,
      next = false;
    const res = {
      status(v) {
        status = v;
        return this;
      },
      json() {
        return this;
      },
    };
    await middleware(
      { headers: { authorization: 'Bearer ' + uid }, baseUrl, path },
      res,
      () => {
        next = true;
      }
    );
    return { status, next };
  }
  assert.deepEqual(
    await check(
      auth.verifyFirebaseToken,
      'newbie',
      '/api/v1/organizations',
      '/orgA'
    ),
    { status: 403, next: false }
  );
  assert.deepEqual(
    await check(
      partner.verifyPartnerFirebaseToken,
      'newbie',
      '/api/v1/partner',
      '/orgs'
    ),
    { status: 403, next: false }
  );
  assert.deepEqual(
    await check(auth.verifyFirebaseToken, 'newbie', '/api/v1/upload', '/image'),
    { status: 200, next: true }
  );
  assert.deepEqual(
    await check(
      auth.verifyFirebaseToken,
      'admin',
      '/api/v1/organizations',
      '/orgA'
    ),
    { status: 200, next: true }
  );
});
test('legacy organisation invite-code join and org-link approvals cannot grant access to a v2 organisation', async () => {
  const f = fixture();
  const r = await f.register();
  const portal = withFirebase('services/partner-portal.service.js', f);
  f.add('outsider');
  await assert.rejects(
    portal.joinOrg({
      partnerUid: 'outsider',
      orgId: r.organisation.id,
      inviteCode: 'invalid',
    }),
    (e) => e.statusCode === 403
  );
  await f.db
    .collection('partnerUsers')
    .doc('outsider')
    .set({ orgId: 'orgB', role: 'partner_staff' });
  await f.db
    .collection('partnerUsers')
    .doc('legacy')
    .set({ orgId: r.organisation.id, role: 'partner_admin' });
  await f.db
    .collection('partnerUsers')
    .doc('outsider')
    .collection('orgLinkRequests')
    .doc('pending')
    .set({ orgId: r.organisation.id, status: 'pending' });
  await assert.rejects(
    portal.approveOrgLinkRequest(
      'legacy',
      'outsider',
      'pending',
      'partner_staff'
    ),
    (e) => e.statusCode === 403
  );
  assert.equal(f.db.data.get('partnerUsers/outsider').orgId, 'orgB');
});
test('legacy org create and join still work for existing portal identities and cannot replace v2 membership', async () => {
  const f = fixture(),
    portal = withFirebase('services/partner-portal.service.js', f);
  const org = await portal.createOrg({
    partnerUid: 'newbie',
    orgName: 'Legacy company',
  });
  assert.equal(f.db.data.get('partnerUsers/newbie').orgId, org.orgId);
  f.add('legacyJoiner');
  await portal.joinOrg({
    partnerUid: 'legacyJoiner',
    orgId: org.orgId,
    inviteCode: org.inviteCode,
  });
  assert.deepEqual(f.db.data.get('partnerUsers/legacyJoiner').roles, [
    'partner_user',
  ]);
  const newer = fixture();
  await newer.register();
  const otherPortal = withFirebase('services/partner-portal.service.js', newer);
  await assert.rejects(
    otherPortal.createOrg({ partnerUid: 'newbie', orgName: 'Replacement' }),
    (e) => e.statusCode === 409
  );
});
test('reactivating an existing owner restores ownership bookkeeping without permitting a new owner grant', async () => {
  const f = fixture();
  await f.register();
  await secondOwner(f);
  await f.v2.updateMember(f.who('newbie'), 'coowner', {
    status: 'inactive',
    version: 1,
  });
  await reject(f.v2.account(f.who('coowner')), 403);
  await f.v2.updateMember(f.who('newbie'), 'coowner', {
    status: 'active',
    version: 2,
  });
  assert.equal((await f.v2.account(f.who('coowner'))).canManageMembers, true);
  const org = f.db.data.get(
    'organizations/' + f.db.data.get('partnerUsers/newbie').orgId
  );
  assert.deepEqual(org.ownerUids.sort(), ['coowner', 'newbie']);
});
