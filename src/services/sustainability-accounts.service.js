const crypto = require('node:crypto');
const { fail, text } = require('./partner-project-policy');
const ACTION_OWNER = 'sustainability_action_owner';
const SERVICE_PROVIDER = 'sustainability_service_provider';
const INVITED_ROLES = ['org_admin', 'org_analyst'];
const OWNER_INVITABLE_ROLES = [...INVITED_ROLES, ACTION_OWNER];
const OWNER_ROLES = [ACTION_OWNER, SERVICE_PROVIDER];
const PROVIDER_SERVICES = ['NGO services', 'ESG services', 'Environmental services'];
const hasAccountType = (org, type) => org?.accountType === type || org?.accountTypes?.includes(type) === true;
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
    lineOfBusiness: data.lineOfBusiness || null,
    accountTypes: data.accountTypes || data.roles || [data.role],
    serviceTypes: data.serviceTypes || [],
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
    accountTypes: data.accountTypes || [data.accountType],
    lineOfBusiness: data.lineOfBusiness || null,
    serviceType: data.serviceType || null,
    serviceTypes: data.serviceTypes || (data.serviceType ? [data.serviceType] : []),
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
    !providers.some((p) => p.providerId === 'password') ||
    email(record.email) !== email(identity.email)
  ) {
    fail(403, 'An active email/password identity is required. Google-only accounts are not supported in this app.');
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
  sendEmailOtp = (data) =>
    require('./email.service').sendEmailVerificationCode(data),
  randomOtp = () => crypto.randomInt(0, 1000000).toString().padStart(6, '0'),
  randomId = () => crypto.randomUUID().replace(/-/g, ''),
} = {}) {
  const users = db.collection('partnerUsers'),
    v2Users = db.collection('partnerV2Users'),
    orgs = db.collection('organizations');
  const invites = db.collection('partnerV2Invitations'),
    keys = db.collection('partnerV2InvitationKeys'),
    collaborators = db.collection('partnerV2Collaborators'),
    emailOtps = db.collection('partnerV2EmailOtps');
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
  const otpPurpose = (invitationId) => invitationId ? `invitation:${invitationId}` : 'registration';
  const otpRef = (address, purpose) => emailOtps.doc(hash(`${address}:${purpose}`));
  const otpDigest = (ref, code) => hash(`${process.env.ORG_INVITE_CODE_SALT || process.env.JWT_SECRET || 'local-email-otp'}:${ref.id}:${code}`);
  async function consumeEmailVerification(tx, address, token, invitationId = null) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,}$/.test(token))
      fail(403, 'Verify your email with the one-time code before continuing.');
    const ref = otpRef(address, otpPurpose(invitationId)), doc = await tx.get(ref), data = doc.data();
    if (!doc.exists || !data.verified || data.consumedAt || data.email !== address || data.purpose !== otpPurpose(invitationId) || data.verificationTokenHash !== hash(token) || Date.parse(data.expiresAt) <= now().getTime())
      fail(403, 'Your email verification expired or was already used. Request a new code.');
    tx.update(ref, { consumedAt: time(), verificationTokenHash: null });
  }
  async function session(identity) {
    return requirePasswordIdentity(auth, identity);
  }
  async function membershipDoc(tx, uid) {
    const scoped = await tx.get(v2Users.doc(uid));
    if (scoped.exists) return scoped;
    return tx.get(users.doc(uid));
  }
  async function access(tx, identity, owner = false) {
    const doc = await membershipDoc(tx, identity.uid);
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
    if (owner && (!OWNER_ROLES.includes(org.data().accountType) ||
      user.role !== org.data().accountType || !org.data().ownerUids?.includes(identity.uid))) {
      fail(
        403,
        'Only the organisation owner can invite and manage members.'
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
    if (!OWNER_INVITABLE_ROLES.includes(data.role))
      fail(403, 'This invitation cannot grant that role.');
  }
  async function linkIn(tx, ref, token) {
    const doc = await tx.get(ref),
      data = doc.data();
    if (!doc.exists || data.tokenHash !== hash(token))
      fail(404, 'Invalid invitation.');
    checkLink(data);
    const org = await tx.get(orgs.doc(identifier(data.orgId)));
    const issuer = await membershipDoc(tx, identifier(data.createdBy));
    if (
      !org.exists ||
      !membershipV2(org.data()) ||
      org.data().status !== 'active' ||
      !OWNER_ROLES.includes(org.data().accountType) ||
      !issuer.exists ||
      !membershipV2(issuer.data()) ||
      issuer.data().status !== 'active' ||
      issuer.data().role !== org.data().accountType ||
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
    async sendEmailVerificationCode(body) {
      fields(body, ['email', 'invitationToken']);
      const address = email(body.email);
      let invitationId = null, orgName = null;
      if (body.invitationToken != null) {
        const ref = await findLink(body.invitationToken);
        const result = await db.runTransaction((tx) => linkIn(tx, ref, body.invitationToken));
        if (result.data.email !== address) fail(403, 'Use the email address on this invitation.');
        invitationId = ref.id;
        orgName = result.org.data().name || null;
      }
      const purpose = otpPurpose(invitationId), ref = otpRef(address, purpose), code = randomOtp(), stamp = now();
      const codeHash = otpDigest(ref, code);
      await db.runTransaction(async (tx) => {
        const current = await tx.get(ref), old = current.data();
        const sentAt = Date.parse(old?.sentAt || '');
        if (Number.isFinite(sentAt) && stamp.getTime() - sentAt < 60_000) fail(429, 'Wait a minute before requesting another verification code.');
        const windowStart = Date.parse(old?.windowStart || '');
        const sends = Number.isFinite(windowStart) && stamp.getTime() - windowStart < 60 * 60_000 ? (old.sendCount || 0) : 0;
        if (sends >= 5) fail(429, 'Too many verification codes requested. Try again in an hour.');
        tx.set(ref, { email: address, purpose, invitationId, codeHash, sentAt: stamp.toISOString(), expiresAt: new Date(stamp.getTime() + 10 * 60_000).toISOString(), attempts: 0, verified: false, verificationTokenHash: null, consumedAt: null, windowStart: sends ? old.windowStart : stamp.toISOString(), sendCount: sends + 1 });
      });
      try {
        const sent = await sendEmailOtp({ to: address, code, expiresInMinutes: 10, organisationName: orgName });
        if (sent?.success !== true) throw new Error('SMTP delivery failed.');
      } catch (_) {
        await ref.set({ codeHash: null, deliveryFailed: true }, { merge: true }).catch(() => {});
        fail(503, 'We could not send the verification code. Please try again shortly.');
      }
      return { sent: true, expiresInSeconds: 600, resendAfterSeconds: 60 };
    },
    async verifyEmailVerificationCode(body) {
      fields(body, ['email', 'code', 'invitationToken']);
      const address = email(body.email), code = body.code;
      if (typeof code !== 'string' || !/^\d{6}$/.test(code)) fail(400, 'Enter the six-digit code from your email.');
      let invitationId = null;
      if (body.invitationToken != null) {
        const ref = await findLink(body.invitationToken);
        const result = await db.runTransaction((tx) => linkIn(tx, ref, body.invitationToken));
        if (result.data.email !== address) fail(403, 'Use the email address on this invitation.');
        invitationId = ref.id;
      }
      const ref = otpRef(address, otpPurpose(invitationId)), token = crypto.randomBytes(32).toString('base64url');
      const outcome = await db.runTransaction(async (tx) => {
        const doc = await tx.get(ref), data = doc.data();
        if (!doc.exists || data.email !== address || data.purpose !== otpPurpose(invitationId) || data.consumedAt || data.verified || Date.parse(data.expiresAt) <= now().getTime()) return { error: 'This verification code expired. Request a new code.' };
        if ((data.attempts || 0) >= 5) return { error: 'Too many incorrect codes. Request a new code.' };
        if (data.codeHash !== otpDigest(ref, code)) {
          tx.update(ref, { attempts: (data.attempts || 0) + 1 });
          return { error: 'That verification code is incorrect.' };
        }
        tx.update(ref, { verified: true, verifiedAt: time(), verificationTokenHash: hash(token) });
        return { success: true };
      });
      if (!outcome.success) fail(400, outcome.error);
      let emailAccountExists = false, passwordLoginAvailable = true, googleSignInOnly = false;
      try {
        const account = await auth.getUserByEmail(address);
        emailAccountExists = true;
        const providerIds = (account.providerData || []).map(p => p.providerId);
        passwordLoginAvailable = providerIds.includes('password');
        googleSignInOnly = providerIds.length === 1 && providerIds[0] === 'google.com';
      } catch (error) {
        if (error.code !== 'auth/user-not-found') {
          emailAccountExists = null;
          passwordLoginAvailable = null;
        }
      }
      return { verified: true, verificationToken: token, emailAccountExists, passwordLoginAvailable, googleSignInOnly };
    },
    async register(identity, body) {
      const who = await session(identity);
      fields(body, [
        'firstName',
        'lastName',
        'title',
        'organisationName',
        'accountType', 'accountTypes',
        'lineOfBusiness', 'serviceType', 'serviceTypes', 'emailVerificationToken',
      ]);
      if (body.accountTypes != null && !Array.isArray(body.accountTypes)) fail(400, 'Select account types from the list.');
      if (body.serviceTypes != null && !Array.isArray(body.serviceTypes)) fail(400, 'Select service categories from the list.');
      const profile = details(body),
        name = text(body.organisationName, 'Organisation name', 150),
        requestedTypes = Array.isArray(body.accountTypes) ? body.accountTypes : [body.accountType ?? ACTION_OWNER],
        accountTypes = [...new Set(requestedTypes)],
        accountType = accountTypes.includes(ACTION_OWNER) ? ACTION_OWNER : accountTypes[0],
        requestedServices = Array.isArray(body.serviceTypes) ? body.serviceTypes : body.serviceType == null ? [] : [body.serviceType],
        serviceTypes = [...new Set(requestedServices)],
        serviceType = serviceTypes[0] || null,
        lineOfBusiness = accountTypes.includes(ACTION_OWNER) ? text(body.lineOfBusiness, 'Line of business', 150) : null;
      if (!accountTypes.length || accountTypes.some((type) => !OWNER_ROLES.includes(type)))
        fail(400, 'Select sustainability action owner, service provider or both.');
      if (accountTypes.includes(SERVICE_PROVIDER) && (!serviceTypes.length || serviceTypes.some((type) => !PROVIDER_SERVICES.includes(type))))
        fail(400, 'Choose at least one supported service: NGO, ESG or Environmental services.');
      if (!accountTypes.includes(SERVICE_PROVIDER) && serviceTypes.length)
        fail(400, 'Service categories are only available to service providers.');
      const nameSlug = name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const slug =
        nameSlug.split('-').reduce((result, word) => {
          if (!word) return result;
          if (!result) return word.slice(0, 24);
          return result.length + word.length + 1 <= 24
            ? `${result}-${word}`
            : result;
        }, '') || 'organisation';
      const suffix =
        randomId().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) ||
        crypto.randomBytes(3).toString('hex');
      const orgId = `${slug}-${suffix}`,
        orgRef = orgs.doc(identifier(orgId));
      return db.runTransaction(async (tx) => {
        const current = await tx.get(users.doc(who.uid));
        if (current.exists) {
          const old = current.data();
          if (
            !membershipV2(old) ||
            old.createdBy !== who.uid ||
            old.registration?.organisationName !== name ||
            old.registration?.lineOfBusiness !== lineOfBusiness ||
            JSON.stringify([...(old.registration?.accountTypes || [old.registration?.accountType]).filter(Boolean)].sort()) !== JSON.stringify([...accountTypes].sort()) ||
            JSON.stringify([...(old.registration?.serviceTypes || (old.registration?.serviceType ? [old.registration.serviceType] : []))].sort()) !== JSON.stringify([...serviceTypes].sort()) ||
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
        await consumeEmailVerification(tx, who.email, body.emailVerificationToken);
        const stamp = time(),
          role = accountType;
        const org = {
          name,
          accountType: role,
          accountTypes,
          lineOfBusiness,
          serviceType,
          serviceTypes,
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
          accountTypes,
          lineOfBusiness,
          serviceType,
          serviceTypes,
          role,
          roles: accountTypes,
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
            accountTypes,
            lineOfBusiness,
            serviceType,
            serviceTypes,
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
          canManageMembers: OWNER_ROLES.includes(c.org.data().accountType) &&
            c.user.role === c.org.data().accountType && c.org.data().ownerUids.includes(who.uid),
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
      const saved = await db.runTransaction(async (tx) => {
        const c = await access(tx, who);
        const next = {
          ...update,
          revision: c.user.revision + 1,
          updatedAt: time(),
        };
        tx.set(c.doc.ref, next, { merge: true });
        if (c.doc.ref.parent.id !== 'partnerV2Users')
          tx.set(legacy(who.uid), next, { merge: true });
        return { user: member(who.uid, { ...c.user, ...next }) };
      });
      if (typeof update.photoURL === 'string') {
        await auth.updateUser(who.uid, { photoURL: update.photoURL }).catch(() => {});
      }
      return saved;
    },
    async listMembers(identity) {
      const who = await session(identity);
      const c = await db.runTransaction((tx) => access(tx, who, true));
      const [docs, scopedDocs] = await Promise.all([
        users.where('orgId', '==', c.orgId).limit(500).get(),
        v2Users.where('orgId', '==', c.orgId).limit(500).get(),
      ]);
      const byUid = new Map([...docs.docs, ...scopedDocs.docs]
        .filter((d) => membershipV2(d.data()))
        .map((d) => [d.id, d]));
      return {
        orgId: c.orgId,
        members: [...byUid.values()].map((d) => member(d.id, d.data())),
        grantableRoles: c.org.data().accountType === ACTION_OWNER ? OWNER_INVITABLE_ROLES : INVITED_ROLES,
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
          target = await membershipDoc(tx, uid);
        if (!target.exists) fail(404, 'Member not found.');
        const old = target.data();
        if (!membershipV2(old) || old.orgId !== c.orgId)
          fail(403, 'This member belongs to another organisation.');
        if (old.revision !== body.version)
          fail(409, 'This member changed. Refresh before updating.');
        const role = body.role || old.role,
          status = body.status || old.status;
        if (
          old.role === c.org.data().accountType &&
          old.status !== 'active' &&
          status === 'active'
        )
          fail(409, 'Owner access can only be restored through a new owner invitation.');
        let owners;
        if (
          old.role === c.org.data().accountType &&
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
                d.data().role === c.org.data().accountType &&
                d.data().status === 'active'
            )
            .map((d) => d.id);
          if (role === c.org.data().accountType && status === 'active') owners.push(uid);
          if (!owners.length)
            fail(
              409,
              'The organisation must retain at least one active owner.'
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
        if (target.ref.parent.id !== 'partnerV2Users')
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
      if (![...INVITED_ROLES, ACTION_OWNER].includes(body.role))
        fail(400, 'Invitations can grant admin or analyst access, with owner transfer available to action-owner organisations.');
      if (to === who.email) fail(403, 'You cannot invite yourself.');
      const token = crypto.randomBytes(32).toString('base64url'),
        ref = invites.doc();
      let link;
      const data = await db.runTransaction(async (tx) => {
        const c = await access(tx, who, true);
        if (body.role === ACTION_OWNER && c.org.data().accountType !== ACTION_OWNER)
          fail(403, 'Service-provider organisations cannot transfer their owner role through invitations.');
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
      return { orgId: c.orgId, invitations: docs.docs.map(invitation) };
    },
    async searchProviders(identity, query) {
      const who = await session(identity), c = await db.runTransaction((tx) => access(tx, who, true));
      if (!hasAccountType(c.org.data(), ACTION_OWNER)) fail(403, 'Only action-owner organisations can add service-provider collaborators.');
      if (typeof query !== 'string') fail(400, 'Enter a search term.');
      const term = query.trim().toLocaleLowerCase();
      if (term.length < 2) fail(400, 'Enter at least two characters to search.');
      const snapshot = await orgs.limit(500).get();
      const results = [];
      for (const doc of snapshot.docs) {
        const org = doc.data();
        if (org.status !== 'active' || !hasAccountType(org, SERVICE_PROVIDER) || doc.id === c.orgId || ![org.name, ...(org.serviceTypes || [org.serviceType])].some(v => String(v || '').toLocaleLowerCase().includes(term))) continue;
        const owners = await Promise.all((org.ownerUids || []).map(uid => users.doc(uid).get()));
        const owner = owners.find(d => d.exists && d.data().status === 'active' && (d.data().roles || [d.data().role]).includes(SERVICE_PROVIDER));
        if (owner) results.push({ orgId: doc.id, orgName: org.name, serviceType: org.serviceType || null, serviceTypes: org.serviceTypes || (org.serviceType ? [org.serviceType] : []), ownerName: owner.data().name || `${owner.data().firstName || ''} ${owner.data().lastName || ''}`.trim() });
      }
      return { providers: results.slice(0, 50) };
    },
    async listCollaborators(identity) {
      const who = await session(identity), c = await db.runTransaction((tx) => access(tx, who));
      if (hasAccountType(c.org.data(), ACTION_OWNER)) {
        const docs = await collaborators.where('actionOwnerOrgId', '==', c.orgId).limit(500).get();
        return { collaborators: docs.docs.filter(d => d.data().status === 'active').map(d => ({ providerOrgId: d.data().providerOrgId, orgName: d.data().providerOrgName, serviceType: d.data().serviceType || null, access: d.data().access, status: d.data().status })) };
      }
      if (hasAccountType(c.org.data(), SERVICE_PROVIDER)) {
        const docs = await collaborators.where('providerOrgId', '==', c.orgId).limit(500).get();
        return { collaborators: docs.docs.filter(d => d.data().status === 'active').map(d => ({ orgId: d.data().actionOwnerOrgId, orgName: d.data().actionOwnerOrgName, access: d.data().access, status: d.data().status })) };
      }
      return { collaborators: [] };
    },
    async addCollaborator(identity, body) {
      const who = await session(identity); fields(body, ['providerOrgId', 'access']);
      const providerOrgId = identifier(body.providerOrgId);
      if (!['read', 'write'].includes(body.access)) fail(400, 'Choose read or write access.');
      return db.runTransaction(async tx => {
        const c = await access(tx, who, true);
        if (!hasAccountType(c.org.data(), ACTION_OWNER)) fail(403, 'Only action-owner organisations can add service-provider collaborators.');
        const provider = await tx.get(orgs.doc(providerOrgId));
        if (!provider.exists || provider.data().status !== 'active' || !hasAccountType(provider.data(), SERVICE_PROVIDER)) fail(404, 'Active service-provider organisation not found.');
        const ownerDocs = await Promise.all((provider.data().ownerUids || []).map(uid => tx.get(users.doc(uid))));
        const owner = ownerDocs.find(d => d.exists && d.data().status === 'active' && (d.data().roles || [d.data().role]).includes(SERVICE_PROVIDER) && d.data().orgId === providerOrgId);
        if (!owner) fail(409, 'The service-provider organisation has no active owner.');
        const ref = collaborators.doc(hash(`${c.orgId}:${providerOrgId}`));
        const previous = await tx.get(ref), stamp = time();
        const data = { actionOwnerOrgId: c.orgId, actionOwnerOrgName: c.org.data().name, providerOrgId, providerOrgName: provider.data().name, serviceType: provider.data().serviceType || null, serviceTypes: provider.data().serviceTypes || (provider.data().serviceType ? [provider.data().serviceType] : []), providerOwnerUid: owner.id, access: body.access, status: 'active', addedBy: who.uid, createdAt: previous.exists ? previous.data().createdAt : stamp, updatedAt: stamp };
        tx.set(ref, data);
        audit(tx, who.uid, 'sustainability.collaborator.added', c.orgId, providerOrgId, { access: body.access });
        return { collaborator: { providerOrgId, orgName: data.providerOrgName, serviceType: data.serviceType, serviceTypes: data.serviceTypes, access: data.access, status: data.status } };
      });
    },
    async updateCollaborator(identity, providerOrgId, body) {
      const who = await session(identity); identifier(providerOrgId); fields(body, ['access', 'status']);
      if ((body.access != null && !['read', 'write'].includes(body.access)) || (body.status != null && !['active', 'inactive'].includes(body.status))) fail(400, 'Choose read/write access or active/inactive status.');
      return db.runTransaction(async tx => {
        const c = await access(tx, who, true);
        if (!hasAccountType(c.org.data(), ACTION_OWNER)) fail(403, 'Only action-owner organisations can manage collaborators.');
        const ref = collaborators.doc(hash(`${c.orgId}:${providerOrgId}`)), doc = await tx.get(ref);
        if (!doc.exists) fail(404, 'Collaborator not found.');
        const next = { ...(body.access ? { access: body.access } : {}), ...(body.status ? { status: body.status } : {}), updatedAt: time() };
        tx.update(ref, next); audit(tx, who.uid, `sustainability.collaborator.${body.status === 'inactive' ? 'removed' : 'updated'}`, c.orgId, providerOrgId, next);
        return { success: true };
      });
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
      const result = await db.runTransaction(async (tx) => {
        const { data, org } = await linkIn(tx, ref, token);
        return {
          email: data.email,
          role: data.role,
          organisation: organisation(org.id, org.data()),
          expiresAt: data.expiresAt,
        };
      });
      let existingAccount = false, firstName = '', lastName = '';
      try {
        const identity = await auth.getUserByEmail(result.email);
        existingAccount = true;
        const membership = await users.doc(identity.uid).get();
        const profile = membership.exists ? membership.data() : {};
        firstName = profile.firstName || identity.displayName?.trim().split(/\s+/)[0] || '';
        lastName = profile.lastName || identity.displayName?.trim().split(/\s+/).slice(1).join(' ') || '';
      } catch (error) {
        if (error.code !== 'auth/user-not-found') throw error;
      }
      return { ...result, existingAccount, ...(existingAccount ? { firstName, lastName } : {}) };
    },
    async acceptInvitation(identity, body) {
      const who = await session(identity);
      fields(body, ['token', 'firstName', 'lastName', 'title', 'emailVerificationToken']);
      const profile = {
        firstName: typeof body.firstName === 'string' ? body.firstName.trim() : '',
        lastName: typeof body.lastName === 'string' ? body.lastName.trim() : '',
        title: typeof body.title === 'string' ? body.title.trim() : '',
      };
      if ([profile.firstName, profile.lastName, profile.title].some((v) => v.length > 150))
        fail(400, 'Profile details are too long.');
      const ref = await findLink(body.token);
      const result = await db.runTransaction(async (tx) => {
        const { data, org } = await linkIn(tx, ref, body.token);
        if (data.email !== who.email)
          fail(403, 'Sign in with the email that received this invitation.');
        const [old, scopedOld] = await Promise.all([
          tx.get(users.doc(who.uid)),
          tx.get(v2Users.doc(who.uid)),
        ]);
        const membership = scopedOld.exists ? scopedOld : old;
        const existingMembership = membership.data();
        const ownerTransferToExistingMember =
          data.role === ACTION_OWNER &&
          membership.exists &&
          membershipV2(existingMembership) &&
          existingMembership.orgId === org.id &&
          existingMembership.status === 'active' &&
          INVITED_ROLES.includes(existingMembership.role) &&
          existingMembership.email === who.email;
        if (scopedOld.exists && !ownerTransferToExistingMember)
          fail(409, 'This identity already has a sustainability membership.');
        if (old.exists && membershipV2(old.data()) && !ownerTransferToExistingMember)
          fail(409, 'This identity already has a sustainability membership.');
        const key = keys.doc(data.keyId),
          reservation = await tx.get(key);
        if (
          !reservation.exists ||
          reservation.data().invitationId !== ref.id ||
          reservation.data().revoked ||
          reservation.data().used
        )
          fail(409, 'This invitation is no longer current.');
        let previousOwner = null;
        if (data.role === ACTION_OWNER) {
          const owners = org.data().ownerUids || [];
          if (owners.length !== 1 || owners[0] === who.uid)
            fail(409, 'This organisation cannot complete an owner transfer.');
          previousOwner = await tx.get(users.doc(identifier(owners[0])));
          const previous = previousOwner.data();
          if (
            !previousOwner.exists ||
            !membershipV2(previous) ||
            previous.orgId !== org.id ||
            previous.role !== ACTION_OWNER ||
            previous.status !== 'active'
          )
            fail(409, 'The current organisation owner is not active.');
        }
        const stamp = time(),
          existingProfile = existingMembership || (old.exists ? old.data() : {}),
          acceptedProfile = {
            firstName: profile.firstName || existingProfile.firstName || who.email.split('@')[0],
            lastName: profile.lastName || existingProfile.lastName || '',
            title: profile.title || existingProfile.title || '',
          },
          user = {
            ...existingProfile,
            ...acceptedProfile,
            name: `${acceptedProfile.firstName} ${acceptedProfile.lastName}`.trim(),
            ...who,
            orgId: org.id,
            accountType: org.data().accountType,
            lineOfBusiness: org.data().lineOfBusiness || null,
            role: data.role,
            roles: [data.role],
            scope: { type: 'org' },
            status: 'active',
            membershipVersion: 2,
            revision: membershipV2(existingMembership) ? (existingMembership.revision || 0) + 1 : 1,
            invitedBy: data.createdBy,
            invitationId: ref.id,
            createdAt: membershipV2(existingMembership) ? existingMembership.createdAt : stamp,
            updatedAt: stamp,
          };
        await consumeEmailVerification(tx, who.email, body.emailVerificationToken, ref.id);
        if (scopedOld.exists) tx.set(v2Users.doc(who.uid), user, { merge: true });
        else if (old.exists && membershipV2(old.data())) tx.set(users.doc(who.uid), user, { merge: true });
        else if (old.exists) tx.create(v2Users.doc(who.uid), user);
        else tx.create(users.doc(who.uid), user);
        if (!old.exists || membershipV2(old.data())) tx.set(legacy(who.uid), user, { merge: true });
        if (previousOwner) {
          const former = previousOwner.data(),
            inactive = {
              status: 'inactive',
              revision: former.revision + 1,
              updatedAt: stamp,
              updatedBy: who.uid,
              ownerTransferredTo: who.uid,
              ownerTransferredAt: stamp,
            };
          tx.set(previousOwner.ref, inactive, { merge: true });
          tx.set(legacy(previousOwner.id), inactive, { merge: true });
          tx.update(org.ref, {
            ownerUids: [who.uid],
            revision: org.data().revision + 1,
            updatedAt: stamp,
          });
          audit(
            tx,
            who.uid,
            'sustainability.owner.transferred',
            org.id,
            previousOwner.id,
            { newOwnerUid: who.uid, invitationId: ref.id }
          );
        }
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
          ...(previousOwner ? { ownerTransfer: { formerOwnerUid: previousOwner.id } } : {}),
        };
      });
      if (result.ownerTransfer) {
        let formerOwnerAuthDisabled = false;
        if (typeof auth.updateUser === 'function') {
          try {
            await auth.updateUser(result.ownerTransfer.formerOwnerUid, {
              disabled: true,
            });
            formerOwnerAuthDisabled = true;
          } catch (_) {
            formerOwnerAuthDisabled = false;
          }
        }
        if (formerOwnerAuthDisabled) {
          const disabledAt = time();
          await Promise.all([
            users.doc(result.ownerTransfer.formerOwnerUid).set(
              { authDisabledAt: disabledAt },
              { merge: true }
            ),
            legacy(result.ownerTransfer.formerOwnerUid).set(
              { authDisabledAt: disabledAt },
              { merge: true }
            ),
          ]).catch(() => {});
        }
        return {
          ...result,
          ownerTransfer: {
            complete: true,
            formerOwnerAuthDisabled,
            ...(formerOwnerAuthDisabled
              ? {}
              : {
                  warning:
                    'Ownership transferred, but the previous Firebase sign-in could not be disabled automatically. Contact an administrator.',
                }),
          },
        };
      }
      return result;
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
