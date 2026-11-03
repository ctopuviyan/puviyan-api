const crypto = require('node:crypto');
const {
  fail,
  contextFor,
  assertOrg,
  text,
} = require('./partner-project-policy');
const ALL_ROLES = [
  'puviyan_admin',
  'org_admin',
  'org_analyst',
  'partner_admin',
  'partner_staff',
  'partner_user',
];
const rolesOf = (user) => [
  ...new Set(
    [...(Array.isArray(user?.roles) ? user.roles : []), user?.role].filter(
      Boolean
    )
  ),
];
const canManage = (c) =>
  c.superAdmin ||
  (!c.departmentScoped &&
    c.roles.some((r) => ['org_admin', 'partner_admin'].includes(r)));
function requireManager(c) {
  if (!canManage(c))
    fail(403, 'Organisation administrator access is required.');
}
function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    fail(400, 'Invalid identifier.');
  return value;
}
function email(value) {
  const e = text(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail(400, 'Enter a valid email.');
  return e;
}
function selectedRoles(value, c) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some((r) => !ALL_ROLES.includes(r))
  )
    fail(400, 'Choose at least one supported role.');
  const roles = [...new Set(value)];
  if (!c.superAdmin && roles.includes('puviyan_admin'))
    fail(403, 'Only a super admin can grant super-admin access.');
  return ALL_ROLES.filter((r) => roles.includes(r));
}
function photoUrl(value) {
  if (value == null || value === '') return null;
  try {
    const u = new URL(value);
    if (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      value.length <= 2048
    )
      return value;
  } catch (_) {}
  fail(400, 'Use a valid HTTPS photo URL.');
}
function iso(value) {
  return (
    value?.toDate?.()?.toISOString() ||
    (value instanceof Date ? value.toISOString() : value || null)
  );
}
const version = (user) =>
  String(user?.updatedAt?.toMillis?.() ?? iso(user?.updatedAt) ?? 'initial');
function safeUser(uid, user) {
  return {
    uid,
    name: user.name || user.displayName || '',
    email: user.email || '',
    orgId: user.orgId || null,
    roles: rolesOf(user),
    scope: user.scope || { type: 'org' },
    status: user.status || 'active',
    version: version(user),
  };
}
function safeRequest(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    name: d.name || '',
    email: d.email || '',
    kind: d.kind || 'signup',
    organizationName: d.organizationName || '',
    assignedOrgId: d.assignedOrgId || null,
    requestedRoles: d.requestedRoles || [],
    reason: d.reason || '',
    status: d.status,
    rejectionReason: d.rejectionReason || '',
    createdAt: iso(d.createdAt),
    signupUrl: d.signupUrl || null,
    assignedRoles: d.assignedRoles || (d.assignedRole ? [d.assignedRole] : []),
  };
}
function safeInvite(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    email: d.email,
    name: d.name || '',
    orgId: d.orgId,
    orgName: d.orgName,
    roles: d.roles || [d.role],
    scope: d.scope || { type: 'org' },
    used: !!d.used,
    revoked: !!d.revoked,
    expiresAt: iso(d.expiresAt),
    createdAt: iso(d.createdAt),
  };
}

function createPartnerManagement({
  db,
  auth,
  sendInvitation = (...args) =>
    require('./email.service').sendSignupLinkEmail(...args),
  sendRejection = (...args) =>
    require('./email.service').sendRejectionEmail(...args),
  portalUrl = process.env.PARTNER_PORTAL_URL,
  now = () => new Date(),
}) {
  const users = db.collection('partnerUsers'),
    requests = db.collection('signupRequests'),
    links = db.collection('signupLinks'),
    orgs = db.collection('organizations');
  const audit = (tx, actor, action, target, before, after) =>
    tx.create(db.collection('partnerUserAudit').doc(), {
      actorUid: actor.uid,
      action,
      target,
      before: before || null,
      after: after || null,
      createdAt: now().toISOString(),
    });
  async function actorIn(tx, c) {
    const d = await tx.get(users.doc(c.uid));
    return contextFor(c.uid, d.exists ? d.data() : null);
  }
  async function scopeFor(orgId, input = { type: 'org' }) {
    if (!input || !['org', 'departments'].includes(input.type))
      fail(400, 'Choose organisation-wide or department access.');
    if (input.type === 'org') return { type: 'org' };
    if (
      !Array.isArray(input.departmentIds) ||
      !input.departmentIds.length ||
      input.departmentIds.length > 100
    )
      fail(400, 'Select at least one department.');
    const departmentIds = [...new Set(input.departmentIds.map(id))];
    const docs = await Promise.all(
      departmentIds.map((d) =>
        orgs.doc(orgId).collection('departments').doc(d).get()
      )
    );
    if (docs.some((d) => !d.exists))
      fail(400, 'A selected department no longer exists.');
    return { type: 'departments', departmentIds };
  }
  async function activeOrg(orgId) {
    const d = await orgs.doc(id(orgId)).get();
    if (!d.exists || (d.data().status && d.data().status !== 'active'))
      fail(400, 'Select an active organisation.');
    return d.data();
  }
  function targetAccess(c, target) {
    requireManager(c);
    if (rolesOf(target).includes('puviyan_admin') && !c.superAdmin)
      fail(403, 'Only super admins can manage this user.');
    if (!c.superAdmin) assertOrg(c, target.orgId);
  }
  function invitationUrl(token) {
    if (!portalUrl || !/^https:\/\//.test(portalUrl))
      fail(
        503,
        'The partner portal URL must be configured before creating signup links.'
      );
    return `${portalUrl.replace(/\/$/, '')}/signup?token=${encodeURIComponent(token)}`;
  }
  function linkData(body, orgId, org, roles, scope, actor, token) {
    return {
      email: email(body.email),
      name: text(body.name, 'Name', 100),
      orgId,
      orgName: org.name || orgId,
      role: roles[0],
      roles,
      scope,
      used: false,
      revoked: false,
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      createdBy: actor.uid,
      createdAt: now(),
      updatedAt: now(),
      expiresAt: new Date(now().getTime() + 7 * 86400000),
    };
  }
  async function delivery(data, signupUrl, enabled) {
    if (!enabled) return { emailSent: false, emailRequested: false };
    try {
      const r = await sendInvitation({
        to: data.email,
        name: String(data.name).replace(
          /[&<>"']/g,
          (c) =>
            ({
              '&': '&amp;',
              '<': '&lt;',
              '>': '&gt;',
              '"': '&quot;',
              "'": '&#39;',
            })[c]
        ),
        signupUrl,
        orgName: String(data.orgName).replace(
          /[&<>]/g,
          (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]
        ),
      });
      return {
        emailRequested: true,
        emailSent: r.success === true,
        ...(r.success
          ? {}
          : {
              emailError:
                'The email could not be delivered. Copy the signup link instead.',
            }),
      };
    } catch (_) {
      return {
        emailRequested: true,
        emailSent: false,
        emailError:
          'The email could not be delivered. Copy the signup link instead.',
      };
    }
  }
  return {
    async account(identity) {
      const [u, p] = await Promise.all([
        auth.getUser(identity.uid),
        users.doc(identity.uid).get(),
      ]);
      let c = null;
      try {
        c = contextFor(identity.uid, p.exists ? p.data() : null);
      } catch (_) {}
      const organisation = p.data()?.orgId
        ? await orgs.doc(p.data().orgId).get()
        : null;
      return {
        organisationName:
          organisation?.data()?.name ||
          (c?.superAdmin ? 'All organisations' : 'Not assigned'),
        uid: u.uid,
        email: u.email || identity.email || '',
        displayName: u.displayName || p.data()?.name || '',
        photoURL: u.photoURL || null,
        providers: (u.providerData || []).map((p) => p.providerId),
        partner: p.exists ? safeUser(p.id, p.data()) : null,
        canManage: !!c && canManage(c),
        isSuperAdmin: !!c?.superAdmin,
      };
    },
    async profile(identity, body) {
      if (
        Object.keys(body).some((k) => !['displayName', 'photoURL'].includes(k))
      )
        fail(400, 'Only name and photo can be changed here.');
      const update = {
        displayName: text(body.displayName, 'Display name', 100),
      };
      if ('photoURL' in body) update.photoURL = photoUrl(body.photoURL);
      await auth.updateUser(identity.uid, update);
      const stamp = now().toISOString();
      // Keep both portal profile representations in sync without touching access fields.
      await db
        .collection('partner_users')
        .doc(identity.uid)
        .set({ ...update, updatedAt: stamp }, { merge: true });
      const p = await users.doc(identity.uid).get();
      if (p.exists)
        await users.doc(identity.uid).set(
          {
            name: update.displayName,
            ...('photoURL' in update ? { photoURL: update.photoURL } : {}),
            updatedAt: stamp,
          },
          { merge: true }
        );
      return { success: true, ...update };
    },
    async ownRequests(identity) {
      const e = email(identity.email);
      const snap = await requests.where('email', '==', e).limit(200).get();
      return {
        requests: snap.docs
          .map(safeRequest)
          .sort((a, b) =>
            String(b.createdAt).localeCompare(String(a.createdAt))
          ),
      };
    },
    async requestRoles(c, identity, body) {
      if (c.superAdmin) fail(400, 'Super admins already have full access.');
      const requestedRoles = selectedRoles(body.roles, { superAdmin: false });
      const pending = await requests
        .where('email', '==', email(identity.email))
        .get();
      if (
        pending.docs.some(
          (d) =>
            d.data().kind === 'role_change' && d.data().status === 'pending'
        )
      )
        fail(409, 'A role request is already pending.');
      const ref = await requests.add({
        kind: 'role_change',
        uid: c.uid,
        email: email(identity.email),
        name: body.name || identity.email,
        assignedOrgId: c.orgId,
        organizationName: body.organizationName || '',
        requestedRoles,
        reason: text(body.reason, 'Reason', 1000),
        status: 'pending',
        createdAt: now(),
        updatedAt: now(),
      });
      return { id: ref.id, status: 'pending' };
    },
    async organisations(c) {
      requireManager(c);
      const snap = c.superAdmin
        ? await orgs.limit(500).get()
        : { docs: [await orgs.doc(c.orgId).get()] };
      return {
        organisations: await Promise.all(
          snap.docs
            .filter((d) => d.exists)
            .map(async (d) => {
              const departments = await d.ref
                .collection('departments')
                .limit(200)
                .get();
              return {
                id: d.id,
                name: d.data().name || d.id,
                logoUrl: d.data().logoUrl || null,
                status: d.data().status || 'active',
                departments: departments.docs.map((p) => ({
                  id: p.id,
                  name: p.data().name || p.id,
                })),
              };
            })
        ),
      };
    },
    async saveOrganisation(c, orgId, body) {
      requireManager(c);
      if (!orgId && !c.superAdmin)
        fail(403, 'Only super admins can create organisations.');
      if (orgId) assertOrg(c, id(orgId));
      const ref = orgId ? orgs.doc(orgId) : orgs.doc();
      const name = text(body.name, 'Organisation name', 100),
        logoUrl = photoUrl(body.logoUrl);
      await db.runTransaction(async (tx) => {
        const actor = await actorIn(tx, c);
        requireManager(actor);
        if (orgId) assertOrg(actor, orgId);
        else if (!actor.superAdmin)
          fail(403, 'Super admin access is required.');
        const old = await tx.get(ref);
        if (orgId && !old.exists) fail(404, 'Organisation not found.');
        tx.set(
          ref,
          {
            name,
            logoUrl,
            updatedAt: now().toISOString(),
            updatedBy: actor.uid,
            ...(!orgId
              ? {
                  status: 'active',
                  createdAt: now().toISOString(),
                  createdBy: actor.uid,
                }
              : {}),
          },
          { merge: true }
        );
        audit(
          tx,
          actor,
          orgId ? 'organisation.updated' : 'organisation.created',
          ref.id,
          null,
          { name, logoUrl }
        );
      });
      return { id: ref.id, name, logoUrl };
    },
    async listUsers(c, orgId) {
      requireManager(c);
      if (orgId) assertOrg(c, orgId);
      else if (!c.superAdmin) orgId = c.orgId;
      const query = orgId ? users.where('orgId', '==', orgId) : users;
      const snap = await query.limit(500).get();
      return {
        users: snap.docs
          .map((d) => safeUser(d.id, d.data()))
          .filter((u) => c.superAdmin || !u.roles.includes('puviyan_admin')),
        grantableRoles: ALL_ROLES.filter(
          (r) => c.superAdmin || r !== 'puviyan_admin'
        ),
      };
    },
    async updateUser(c, uid, body) {
      requireManager(c);
      id(uid);
      if (uid === c.uid)
        fail(403, 'Ask another administrator to change your own access.');
      if (!['active', 'inactive'].includes(body.status))
        fail(400, 'Choose active or inactive access.');
      const roles = selectedRoles(body.roles, c);
      const orgId =
        body.orgId || (roles.includes('puviyan_admin') ? null : c.orgId);
      if (orgId) {
        assertOrg(c, orgId);
        await activeOrg(orgId);
      } else if (!roles.includes('puviyan_admin'))
        fail(400, 'An organisation is required.');
      const scope = orgId ? await scopeFor(orgId, body.scope) : { type: 'org' };
      await db.runTransaction(async (tx) => {
        const actor = await actorIn(tx, c);
        requireManager(actor);
        selectedRoles(roles, actor);
        const ref = users.doc(uid),
          old = await tx.get(ref);
        if (!old.exists) fail(404, 'User not found.');
        targetAccess(actor, old.data());
        if (orgId) assertOrg(actor, orgId);
        if (body.version !== version(old.data()))
          fail(
            409,
            'This user changed since you opened it. Refresh and try again.'
          );
        const next = {
          roles,
          role: roles[0],
          status: body.status,
          orgId,
          scope,
          updatedAt: now().toISOString(),
          updatedBy: actor.uid,
        };
        tx.set(ref, next, { merge: true });
        tx.set(db.collection('partner_users').doc(uid), next, { merge: true });
        audit(
          tx,
          actor,
          'user.access.updated',
          uid,
          safeUser(uid, old.data()),
          next
        );
      });
      // Disabled identities cannot sign in, and partner token verification checks revocation.
      try {
        await auth.updateUser(uid, { disabled: body.status === 'inactive' });
        const identity = await auth.getUser(uid);
        await auth.setCustomUserClaims(uid, {
          ...(identity.customClaims || {}),
          orgId,
          roles,
        });
        if (body.status === 'inactive') await auth.revokeRefreshTokens(uid);
      } catch (_) {
        fail(
          503,
          'Access was saved, but sign-in status could not be synchronized. Retry this user update.'
        );
      }
      return { user: safeUser(uid, (await users.doc(uid).get()).data()) };
    },
    async listInvites(c, orgId) {
      requireManager(c);
      if (orgId) assertOrg(c, orgId);
      else if (!c.superAdmin) orgId = c.orgId;
      const snap = await (orgId ? links.where('orgId', '==', orgId) : links)
        .limit(500)
        .get();
      return {
        invitations: snap.docs
          .map(safeInvite)
          .sort((a, b) =>
            String(b.createdAt).localeCompare(String(a.createdAt))
          ),
      };
    },
    async invite(c, body) {
      requireManager(c);
      const orgId = body.orgId || c.orgId;
      assertOrg(c, orgId);
      const org = await activeOrg(orgId),
        roles = selectedRoles(body.roles || [body.role], c),
        scope = await scopeFor(orgId, body.scope);
      const token = crypto.randomBytes(32).toString('base64url'),
        url = invitationUrl(token);
      const data = linkData(body, orgId, org, roles, scope, c, token),
        ref = links.doc();
      const existing = await links.where('email', '==', data.email).get();
      if (
        existing.docs.some(
          (d) =>
            d.data().orgId === orgId &&
            !d.data().used &&
            !d.data().revoked &&
            new Date(iso(d.data().expiresAt)).getTime() > now().getTime()
        )
      )
        fail(
          409,
          'An invitation is already pending. Use Renew link in Invitations.'
        );
      await db.runTransaction(async (tx) => {
        const actor = await actorIn(tx, c);
        requireManager(actor);
        assertOrg(actor, orgId);
        selectedRoles(roles, actor);
        tx.create(ref, data);
        audit(tx, actor, 'invitation.created', ref.id, null, {
          email: data.email,
          orgId,
          roles,
          scope,
        });
      });
      return {
        id: ref.id,
        signupUrl: url,
        ...(await delivery(data, url, body.sendEmail === true)),
      };
    },
    async changeInvite(c, linkId, body) {
      requireManager(c);
      const ref = links.doc(id(linkId));
      const token = crypto.randomBytes(32).toString('base64url'),
        url = body.revoke ? null : invitationUrl(token);
      let data;
      await db.runTransaction(async (tx) => {
        const actor = await actorIn(tx, c);
        requireManager(actor);
        const old = await tx.get(ref);
        if (!old.exists) fail(404, 'Invitation not found.');
        data = old.data();
        assertOrg(actor, data.orgId);
        selectedRoles(data.roles || [data.role], actor);
        if (data.used) fail(409, 'This invitation has already been used.');
        if (!body.revoke && data.revoked)
          fail(409, 'Create a new invitation after revocation.');
        tx.update(
          ref,
          body.revoke
            ? { revoked: true, updatedAt: now() }
            : {
                tokenHash: crypto
                  .createHash('sha256')
                  .update(token)
                  .digest('hex'),
                expiresAt: new Date(now().getTime() + 7 * 86400000),
                updatedAt: now(),
              }
        );
        audit(
          tx,
          actor,
          body.revoke ? 'invitation.revoked' : 'invitation.renewed',
          ref.id,
          null,
          { orgId: data.orgId }
        );
      });
      return {
        success: true,
        signupUrl: url,
        ...(!body.revoke
          ? await delivery(data, url, body.sendEmail === true)
          : {}),
      };
    },
    async listRequests(c, status = 'pending') {
      requireManager(c);
      if (!['pending', 'approved', 'rejected'].includes(status))
        fail(400, 'Invalid request status.');
      const query = c.superAdmin
        ? requests
        : requests.where('assignedOrgId', '==', c.orgId);
      const snap = await query.limit(500).get();
      return {
        requests: snap.docs
          .filter((d) => d.data().status === status)
          .map(safeRequest)
          .sort((a, b) =>
            String(b.createdAt).localeCompare(String(a.createdAt))
          ),
      };
    },
    async review(c, requestId, body) {
      requireManager(c);
      const ref = requests.doc(id(requestId));
      if (!['approve', 'reject'].includes(body.decision))
        fail(400, 'Choose approve or reject.');
      const reject = body.decision === 'reject',
        roles = reject ? [] : selectedRoles(body.roles, c);
      const initial = await ref.get();
      if (!initial.exists) fail(404, 'Request not found.');
      if (!c.superAdmin) assertOrg(c, initial.data().assignedOrgId);
      const orgId = body.orgId || initial.data().assignedOrgId || c.orgId;
      let org, scope;
      if (!reject) {
        assertOrg(c, orgId);
        org = await activeOrg(orgId);
        scope = await scopeFor(orgId, body.scope);
      }
      const token = crypto.randomBytes(32).toString('base64url'),
        isRole = initial.data().kind === 'role_change';
      const url = !reject && !isRole ? invitationUrl(token) : null,
        linkRef = links.doc();
      const reason = reject ? text(body.reason, 'Rejection reason', 1000) : '';
      let data;
      await db.runTransaction(async (tx) => {
        const actor = await actorIn(tx, c);
        requireManager(actor);
        const current = await tx.get(ref);
        if (!current.exists) fail(404, 'Request not found.');
        data = current.data();
        if (!actor.superAdmin) assertOrg(actor, data.assignedOrgId);
        if (data.uid === actor.uid)
          fail(403, 'Another administrator must review your own request.');
        if (data.status !== 'pending')
          fail(409, 'This request has already been reviewed.');
        if (!reject) {
          assertOrg(actor, orgId);
          selectedRoles(roles, actor);
        }
        let member;
        if (!reject && isRole) {
          member = await tx.get(users.doc(id(data.uid)));
          if (!member.exists) fail(404, 'Partner not found.');
          targetAccess(actor, member.data());
          if (member.data().orgId !== orgId)
            fail(409, 'The partner organisation changed.');
        }
        if (reject)
          tx.update(ref, {
            status: 'rejected',
            rejectionReason: reason,
            rejectedBy: actor.uid,
            rejectedAt: now(),
            updatedAt: now(),
          });
        else {
          if (isRole) {
            const merged = selectedRoles(
              [...rolesOf(member.data()), ...roles],
              actor
            );
            tx.set(
              member.ref,
              {
                roles: merged,
                role: merged[0],
                updatedAt: now().toISOString(),
                updatedBy: actor.uid,
              },
              { merge: true }
            );
            tx.set(
              db.collection('partner_users').doc(member.id),
              {
                roles: merged,
                role: merged[0],
                updatedAt: now().toISOString(),
              },
              { merge: true }
            );
          } else
            tx.create(
              linkRef,
              linkData(data, orgId, org, roles, scope, actor, token)
            );
          tx.update(ref, {
            status: 'approved',
            assignedOrgId: orgId,
            assignedOrgName: org.name,
            assignedRole: roles[0],
            assignedRoles: roles,
            approvedBy: actor.uid,
            approvedAt: now(),
            updatedAt: now(),
            ...(!isRole ? { signupLinkId: linkRef.id, signupUrl: url } : {}),
          });
        }
        audit(
          tx,
          actor,
          `request.${reject ? 'rejected' : 'approved'}`,
          ref.id,
          null,
          { orgId: orgId || null, roles, kind: data.kind || 'signup' }
        );
      });
      let rejectionDelivery = {};
      if (reject && body.sendEmail === true) {
        try {
          const result = await sendRejection({
            to: data.email,
            name: String(data.name || '').replace(/[&<>]/g, ''),
            reason: reason.replace(/[&<>]/g, ''),
          });
          rejectionDelivery = {
            emailRequested: true,
            emailSent: result.success === true,
            ...(result.success
              ? {}
              : {
                  emailError:
                    'The decision was saved but the email could not be delivered.',
                }),
          };
        } catch (_) {
          rejectionDelivery = {
            emailRequested: true,
            emailSent: false,
            emailError:
              'The decision was saved but the email could not be delivered.',
          };
        }
      }
      return {
        success: true,
        signupUrl: url,
        ...rejectionDelivery,
        ...(!reject && !isRole
          ? await delivery(
              { ...data, orgName: org.name },
              url,
              body.sendEmail === true
            )
          : {}),
      };
    },
    async complete(identity, token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 256)
        fail(400, 'Invalid invitation token.');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const snap = await links.where('tokenHash', '==', hash).limit(1).get();
      if (!snap.docs.length) fail(404, 'Invalid or expired invitation.');
      const ref = snap.docs[0].ref;
      let result;
      await db.runTransaction(async (tx) => {
        const [link, old] = await Promise.all([
          tx.get(ref),
          tx.get(users.doc(identity.uid)),
        ]);
        const d = link.data();
        if (
          !d ||
          d.tokenHash !== hash ||
          d.used ||
          d.revoked ||
          !d.expiresAt ||
          new Date(iso(d.expiresAt)).getTime() <= now().getTime()
        )
          fail(409, 'This invitation is expired, revoked, or already used.');
        if (!identity.email || email(d.email) !== email(identity.email))
          fail(403, 'Sign in using the email on this invitation.');
        const org = await tx.get(orgs.doc(id(d.orgId)));
        if (
          !org.exists ||
          (org.data().status && org.data().status !== 'active')
        )
          fail(403, 'The invited organisation is not active.');
        if (old.exists && old.data().status && old.data().status !== 'active')
          fail(
            403,
            'Your access is inactive. Ask an administrator to restore it.'
          );
        if (old.exists && old.data().orgId && old.data().orgId !== d.orgId)
          fail(
            409,
            'This account belongs to another organisation. An administrator must move it.'
          );
        // Existing accounts keep their approved roles and scope; a link cannot silently replace either.
        const roles = selectedRoles(
          [...rolesOf(old.data()), ...(d.roles || [d.role])],
          { superAdmin: true }
        );
        result = {
          uid: identity.uid,
          email: email(identity.email),
          name: old.data()?.name || d.name || identity.email,
          orgId: d.orgId,
          roles,
          role: roles[0],
          scope: old.exists
            ? old.data().scope || { type: 'org' }
            : d.scope || { type: 'org' },
          status: 'active',
          updatedAt: now().toISOString(),
          ...(!old.exists ? { createdAt: now().toISOString() } : {}),
        };
        tx.set(users.doc(identity.uid), result, { merge: true });
        tx.set(db.collection('partner_users').doc(identity.uid), result, {
          merge: true,
        });
        tx.update(ref, {
          used: true,
          usedBy: identity.uid,
          usedAt: now(),
          updatedAt: now(),
        });
        audit(tx, { uid: identity.uid }, 'invitation.completed', ref.id, null, {
          roles,
          orgId: d.orgId,
        });
      });
      return { success: true, user: result };
    },
  };
}
module.exports = {
  createPartnerManagement,
  rolesOf,
  canManage,
  selectedRoles,
  safeUser,
};
