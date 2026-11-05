const assert = require('node:assert/strict');
const {
  createPartnerManagement,
} = require('../../src/services/partner-management.service');
const { contextFor } = require('../../src/services/partner-project-policy');
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
      return {
        uid: u.uid,
        email: u.email,
        firebase: { sign_in_provider: u.signInProvider || 'password' },
      };
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
module.exports = { store };
