const crypto = require('node:crypto');
const { fail, text } = require('./partner-project-policy');
const ACTION_OWNER = 'sustainability_action_owner';
const SERVICE_PROVIDER = 'sustainability_service_provider';
const INVITED_ROLES = ['org_admin', 'org_analyst'];
const OWNER_ROLES = [ACTION_OWNER, SERVICE_PROVIDER];
const membershipV2 = (value) => value?.membershipVersion === 2;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    fail(400, 'Invalid identifier.');
  return value;
}
function email(value) {
  const result = text(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
    fail(400, 'Enter a valid email.');
  return result;
}
function fields(body, allowed) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  )
    fail(400, 'Unsupported request fields.');
}
function details(body) {
  const firstName = text(body.firstName, 'First name', 100);
  const lastName = text(body.lastName, 'Last name', 100);
  return {
    firstName,
    lastName,
    title: text(body.title, 'Organisation title', 150),
    name: `${firstName} ${lastName}`,
  };
}
function member(uid, data) {
  return {
    uid,
    email: data.email,
    firstName: data.firstName,
    lastName: data.lastName,
    name: data.name,
    title: data.title,
    photoURL: data.photoURL || null,
    orgId: data.orgId,
    role: data.role,
    roles: data.roles,
    status: data.status,
    version: data.revision,
  };
}
function organisation(id, data) {
  return {
    id,
    name: data.name,
    accountType: data.accountType,
    status: data.status,
  };
}
function invitation(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    email: d.email,
    role: d.role,
    orgId: d.orgId,
    orgName: d.orgName,
    used: d.used,
    revoked: d.revoked,
    expiresAt: d.expiresAt,
    createdAt: d.createdAt,
  };
}
// ID tokens must represent an actual email/password sign-in, not a linked Google or custom-token session.
async function requirePasswordIdentity(auth, identity) {
  if (!identity || identity.signInProvider !== 'password')
    fail(403, 'Sign in with email and password for this account.');
  const record = await auth.getUser(identity.uid);
  const providers = record.providerData || [];
  if (
    record.disabled ||
    !providers.length ||
    providers.some((p) => p.providerId !== 'password') ||
    email(record.email) !== email(identity.email)
  ) {
    fail(403, 'An active email/password-only identity is required.');
  }
  return { uid: record.uid, email: email(record.email) };
}
function createSustainabilityAccounts({
  db,
  auth,
  now = () => new Date(),
  signupUrl = process.env.PARTNER_APP_SIGNUP_URL,
  sendInvitation = (data) =>
    require('./email.service').sendSignupLinkEmail(data),
  randomId = () => crypto.randomUUID().replace(/-/g, ''),
} = {}) {
  const users = db.collection('partnerUsers'),
    orgs = db.collection('organizations');
  const invites = db.collection('partnerV2Invitations'),
    keys = db.collection('partnerV2InvitationKeys');
  const legacy = (uid) => db.collection('partner_users').doc(uid);
  const time = () => now().toISOString();
  function audit(tx, uid, action, orgId, target, data = {}) {
    tx.create(db.collection('partnerUserAudit').doc(), {
      actorUid: uid,
      action,
      orgId,
      target,
      ...data,
      createdAt: time(),
    });
  }
  async function session(identity) {
    return requirePasswordIdentity(auth, identity);
  }
  async function access(tx, identity, owner = false) {
    const doc = await tx.get(users.doc(identity.uid));
    const user = doc.data();
    if (!doc.exists || !membershipV2(user) || user.status !== 'active')
      fail(403, 'An active sustainability membership is required.');
    const org = await tx.get(orgs.doc(identifier(user.orgId)));
    if (
      !org.exists ||
      !membershipV2(org.data()) ||
      org.data().status !== 'active'
    )
      fail(403, 'The organisation is not active.');
    if (
      owner &&
      (org.data().accountType !== ACTION_OWNER ||
        user.role !== ACTION_OWNER ||
        !org.data().ownerUids?.includes(identity.uid))
    ) {
      fail(
        403,
        'Only a sustainability action owner can invite and manage members.'
      );
    }
    return { doc, user, org, orgId: org.id };
  }
  function url(token) {
    let base;
    try {
      base = new URL(signupUrl);
    } catch (_) {
      fail(
        503,
        'Configure PARTNER_APP_SIGNUP_URL for the new signup screen before sending invitations.'
      );
    }
    if (
      base.protocol !== 'https:' ||
      base.username ||
      base.password ||
      base.hash
    )
      fail(503, 'Configure a valid HTTPS signup URL.');
    base.searchParams.set('flow', 'sustainability-v2');
    base.searchParams.set('token', token);
    return base.toString();
  }
  async function deliver(data, link) {
    const escape = (value) =>
      String(value).replace(
        /[&<>"']/g,
        (c) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[c]
      );
    try {
      const result = await sendInvitation({
        to: data.email,
        name: 'partner',
        orgName: escape(data.orgName),
        signupUrl: link,
      });
      return {
        emailSent: result?.success === true,
        ...(result?.success
          ? {}
          : {
              emailError:
                'Invitation saved; delivery failed. Renew it to retry email delivery.',
            }),
      };
    } catch (_) {
      return {
        emailSent: false,
        emailError:
          'Invitation saved; delivery failed. Renew it to retry email delivery.',
      };
    }
  }
  function checkLink(data) {
    if (
      !data ||
      data.used ||
      data.revoked ||
      !Number.isFinite(Date.parse(data.expiresAt)) ||
      Date.parse(data.expiresAt) <= now().getTime()
    )
      fail(409, 'The invitation is expired, revoked or already used.');
    if (!INVITED_ROLES.includes(data.role))
      fail(403, 'This invitation cannot grant that role.');
  }
  async function linkIn(tx, ref, token) {
    const doc = await tx.get(ref),
      data = doc.data();
    if (!doc.exists || data.tokenHash !== hash(token))
      fail(404, 'Invalid invitation.');
    checkLink(data);
    const org = await tx.get(orgs.doc(identifier(data.orgId)));
    const issuer = await tx.get(users.doc(identifier(data.createdBy)));
    if (
      !org.exists ||
      !membershipV2(org.data()) ||
      org.data().status !== 'active' ||
      org.data().accountType !== ACTION_OWNER ||
      !issuer.exists ||
      !membershipV2(issuer.data()) ||
      issuer.data().status !== 'active' ||
      issuer.data().role !== ACTION_OWNER ||
      issuer.data().orgId !== org.id ||
      !org.data().ownerUids?.includes(issuer.id)
    )
      fail(403, 'An active action owner must renew this invitation.');
    return { data, org, doc };
  }
  async function findLink(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))
      fail(400, 'Invalid invitation token.');
    const found = await invites
      .where('tokenHash', '==', hash(token))
      .limit(1)
      .get();
    if (!found.docs.length) fail(404, 'Invalid invitation.');
    return found.docs[0].ref;
  }
  return {
    async register(identity, body) {
      const who = await session(identity);
      fields(body, [
        'firstName',
        'lastName',
        'title',
        'organisationName',
        'accountType',
      ]);
      const profile = details(body),
        name = text(body.organisationName, 'Organisation name', 150);
      if (!OWNER_ROLES.includes(body.accountType))
        fail(
          400,
          'Choose sustainability action owner or sustainability service provider.'
        );
      const slug =
        name
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 60) || 'organisation';
      const orgId = `${slug}-${randomId()}`,
        orgRef = orgs.doc(identifier(orgId));
      return db.runTransaction(async (tx) => {
        const current = await tx.get(users.doc(who.uid));
        if (current.exists) {
          const old = current.data();
          if (
            !membershipV2(old) ||
            old.createdBy !== who.uid ||
            old.registration?.organisationName !== name ||
            old.registration?.accountType !== body.accountType ||
            ['firstName', 'lastName', 'title'].some(
              (k) => old.registration[k] !== profile[k]
            )
          ) {
            fail(
              409,
              'This identity already has a membership. Sign in or use its invitation.'
            );
          }
          const existing = await access(tx, who);
          return {
            created: false,
            user: member(who.uid, old),
            organisation: organisation(existing.orgId, existing.org.data()),
          };
        }
        const taken = await tx.get(orgRef);
        if (taken.exists)
          fail(409, 'Organisation ID collision. Retry registration.');
        const stamp = time(),
          role = body.accountType;
        const org = {
          name,
          accountType: role,
          membershipVersion: 2,
          ownerUids: [who.uid],
          revision: 1,
          status: 'active',
          createdBy: who.uid,
          createdAt: stamp,
          updatedAt: stamp,
        };
        const user = {
          ...profile,
          ...who,
          orgId,
          accountType: role,
          role,
          roles: [role],
          scope: { type: 'org' },
          status: 'active',
          membershipVersion: 2,
          revision: 1,
          createdBy: who.uid,
          createdAt: stamp,
          updatedAt: stamp,
          registration: {
            ...profile,
            organisationName: name,
            accountType: role,
          },
        };
        tx.create(orgRef, org);
        tx.create(users.doc(who.uid), user);
        tx.set(legacy(who.uid), user, { merge: true });
        audit(
          tx,
          who.uid,
          'sustainability.organisation.created',
          orgId,
          who.uid,
          { role }
        );
        return {
          created: true,
          user: member(who.uid, user),
          organisation: organisation(orgId, org),
        };
      });
    },
    async account(identity) {
      const who = await session(identity);
      return db.runTransaction(async (tx) => {
        const c = await access(tx, who);
        return {
          user: member(who.uid, c.user),
          organisation: organisation(c.orgId, c.org.data()),
          canManageMembers:
            c.user.role === ACTION_OWNER &&
            c.org.data().accountType === ACTION_OWNER &&
            c.org.data().ownerUids.includes(who.uid),
        };
      });
    },
    async profile(identity, body) {
      const who = await session(identity);
      fields(body, ['firstName', 'lastName', 'title', 'photoURL']);
      const update = details(body);
      if ('photoURL' in body) {
        if (body.photoURL !== null) {
          let parsed;
          try {
            parsed = new URL(body.photoURL);
          } catch (_) {
            fail(400, 'Use a valid HTTPS photo URL.');
          }
          if (
            parsed.protocol !== 'https:' ||
            parsed.username ||
            parsed.password ||
            body.photoURL.length > 2048
          )
            fail(400, 'Use a valid HTTPS photo URL.');
        }
        update.photoURL = body.photoURL;
      }
      return db.runTransaction(async (tx) => {
        const c = await access(tx, who);
        const next = {
          ...update,
          revision: c.user.revision + 1,
          updatedAt: time(),
        };
        tx.set(c.doc.ref, next, { merge: true });
        tx.set(legacy(who.uid), next, { merge: true });
        return { user: member(who.uid, { ...c.user, ...next }) };
      });
    },
    async listMembers(identity) {
      const who = await session(identity);
      const c = await db.runTransaction((tx) => access(tx, who, true));
      const docs = await users.where('orgId', '==', c.orgId).limit(500).get();
      return {
        orgId: c.orgId,
        members: docs.docs
          .filter((d) => membershipV2(d.data()))
          .map((d) => member(d.id, d.data())),
        grantableRoles: INVITED_ROLES,
      };
    },
    async updateMember(identity, uid, body) {
      const who = await session(identity);
      identifier(uid);
      fields(body, ['role', 'status', 'version']);
      if (!Number.isInteger(body.version) || body.version < 1)
        fail(400, 'A member version is required.');
      if (body.role !== undefined && !INVITED_ROLES.includes(body.role))
        fail(400, 'Only admin or analyst can be assigned here.');
      if (
        body.status !== undefined &&
        !['active', 'inactive'].includes(body.status)
      )
        fail(400, 'Choose active or inactive status.');
      if (body.role === undefined && body.status === undefined)
        fail(400, 'Choose a role or status to change.');
      return db.runTransaction(async (tx) => {
        const c = await access(tx, who, true),
          target = await tx.get(users.doc(uid));
        if (!target.exists) fail(404, 'Member not found.');
        const old = target.data();
        if (!membershipV2(old) || old.orgId !== c.orgId)
          fail(403, 'This member belongs to another organisation.');
        if (old.revision !== body.version)
          fail(409, 'This member changed. Refresh before updating.');
        const role = body.role || old.role,
          status = body.status || old.status;
        let owners;
        if (
          old.role === ACTION_OWNER &&
          (role !== old.role || status !== old.status)
        ) {
          const remaining = (c.org.data().ownerUids || []).filter(
            (id) => id !== uid
          );
          const records = await Promise.all(
            remaining.map((id) => tx.get(users.doc(id)))
          );
          owners = records
            .filter(
              (d) =>
                d.exists &&
                membershipV2(d.data()) &&
                d.data().orgId === c.orgId &&
                d.data().role === ACTION_OWNER &&
                d.data().status === 'active'
            )
            .map((d) => d.id);
          if (role === ACTION_OWNER && status === 'active') owners.push(uid);
          if (!owners.length)
            fail(
              409,
              'The organisation must retain at least one active sustainability action owner.'
            );
        }
        const next = {
          role,
          roles: [role],
          status,
          revision: old.revision + 1,
          updatedAt: time(),
          updatedBy: who.uid,
        };
        tx.set(target.ref, next, { merge: true });
        tx.set(legacy(uid), next, { merge: true });
        if (owners)
          tx.update(c.org.ref, {
            ownerUids: owners,
            revision: c.org.data().revision + 1,
            updatedAt: time(),
          });
        audit(tx, who.uid, 'sustainability.member.updated', c.orgId, uid, {
          before: { role: old.role, status: old.status },
          after: { role, status },
        });
        return { user: member(uid, { ...old, ...next }) };
      });
    },
    async invite(identity, body) {
      const who = await session(identity);
      fields(body, ['email', 'role']);
      const to = email(body.email);
      if (!INVITED_ROLES.includes(body.role))
        fail(400, 'Invitations can grant only admin or analyst access.');
      if (to === who.email) fail(403, 'You cannot invite yourself.');
      const token = crypto.randomBytes(32).toString('base64url'),
        ref = invites.doc();
      let link;
      const data = await db.runTransaction(async (tx) => {
        const c = await access(tx, who, true);
        link = url(token);
        const key = keys.doc(hash(`${c.orgId}:${to}`)),
          prior = await tx.get(key);
        if (
          prior.exists &&
          !prior.data().used &&
          !prior.data().revoked &&
          Date.parse(prior.data().expiresAt) > now().getTime()
        )
          fail(
            409,
            'This email already has a pending invitation. Renew it instead.'
          );
        const stamp = time(),
          expiresAt = new Date(now().getTime() + 7 * 86400000).toISOString();
        const d = {
          orgId: c.orgId,
          orgName: c.org.data().name,
          email: to,
          role: body.role,
          createdBy: who.uid,
          createdAt: stamp,
          updatedAt: stamp,
          expiresAt,
          tokenHash: hash(token),
          used: false,
          revoked: false,
          keyId: key.id,
        };
        tx.create(ref, d);
        tx.set(key, {
          invitationId: ref.id,
          expiresAt,
          used: false,
          revoked: false,
        });
        audit(
          tx,
          who.uid,
          'sustainability.invitation.created',
          c.orgId,
          ref.id,
          { role: body.role, email: to }
        );
        return d;
      });
      return { id: ref.id, signupUrl: link, ...(await deliver(data, link)) };
    },
    async listInvitations(identity) {
      const who = await session(identity),
        c = await db.runTransaction((tx) => access(tx, who, true));
      const docs = await invites.where('orgId', '==', c.orgId).limit(500).get();
      return { invitations: docs.docs.map(invitation) };
    },
    async changeInvitation(identity, id, revoke) {
      const who = await session(identity),
        ref = invites.doc(identifier(id));
      const token = crypto.randomBytes(32).toString('base64url');
      let link = null;
      const data = await db.runTransaction(async (tx) => {
        const c = await access(tx, who, true);
        link = revoke ? null : url(token);
        const doc = await tx.get(ref);
        if (!doc.exists) fail(404, 'Invitation not found.');
        const d = doc.data();
        if (d.orgId !== c.orgId)
          fail(403, 'This invitation belongs to another organisation.');
        if (d.used || d.revoked)
          fail(409, 'This invitation has already been used or revoked.');
        const key = keys.doc(d.keyId),
          reservation = await tx.get(key);
        if (reservation.exists && reservation.data().invitationId !== id)
          fail(409, 'A newer invitation exists for this email.');
        const update = revoke
          ? { revoked: true, updatedAt: time() }
          : {
              tokenHash: hash(token),
              createdBy: who.uid,
              expiresAt: new Date(now().getTime() + 7 * 86400000).toISOString(),
              updatedAt: time(),
            };
        tx.update(ref, update);
        tx.set(key, {
          invitationId: id,
          expiresAt: update.expiresAt || d.expiresAt,
          used: false,
          revoked: !!revoke,
        });
        audit(
          tx,
          who.uid,
          `sustainability.invitation.${revoke ? 'revoked' : 'renewed'}`,
          c.orgId,
          id
        );
        return { ...d, ...update };
      });
      return {
        success: true,
        ...(!revoke ? { signupUrl: link, ...(await deliver(data, link)) } : {}),
      };
    },
    async validateInvitation(token) {
      const ref = await findLink(token);
      return db.runTransaction(async (tx) => {
        const { data, org } = await linkIn(tx, ref, token);
        return {
          email: data.email,
          role: data.role,
          organisation: organisation(org.id, org.data()),
          expiresAt: data.expiresAt,
        };
      });
    },
    async acceptInvitation(identity, body) {
      const who = await session(identity);
      fields(body, ['token', 'firstName', 'lastName', 'title']);
      const profile = details(body),
        ref = await findLink(body.token);
      return db.runTransaction(async (tx) => {
        const { data, org } = await linkIn(tx, ref, body.token);
        if (data.email !== who.email)
          fail(403, 'Sign in with the email that received this invitation.');
        const old = await tx.get(users.doc(who.uid));
        if (old.exists)
          fail(
            409,
            'This identity already has a membership. Invitations cannot move or re-grant existing accounts.'
          );
        const key = keys.doc(data.keyId),
          reservation = await tx.get(key);
        if (
          !reservation.exists ||
          reservation.data().invitationId !== ref.id ||
          reservation.data().revoked ||
          reservation.data().used
        )
          fail(409, 'This invitation is no longer current.');
        const stamp = time(),
          user = {
            ...profile,
            ...who,
            orgId: org.id,
            accountType: org.data().accountType,
            role: data.role,
            roles: [data.role],
            scope: { type: 'org' },
            status: 'active',
            membershipVersion: 2,
            revision: 1,
            invitedBy: data.createdBy,
            invitationId: ref.id,
            createdAt: stamp,
            updatedAt: stamp,
          };
        tx.create(users.doc(who.uid), user);
        tx.set(legacy(who.uid), user, { merge: true });
        tx.update(ref, {
          used: true,
          usedBy: who.uid,
          usedAt: stamp,
          updatedAt: stamp,
        });
        tx.update(key, { used: true });
        audit(
          tx,
          who.uid,
          'sustainability.invitation.accepted',
          org.id,
          who.uid,
          { invitationId: ref.id, role: data.role }
        );
        return {
          user: member(who.uid, user),
          organisation: organisation(org.id, org.data()),
        };
      });
    },
  };
}
module.exports = {
  createSustainabilityAccounts,
  requirePasswordIdentity,
  membershipV2,
  ACTION_OWNER,
  SERVICE_PROVIDER,
  INVITED_ROLES,
};
