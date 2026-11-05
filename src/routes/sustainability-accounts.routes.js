const express = require('express');
const { fail } = require('../services/partner-project-policy');
const {
  createSustainabilityAccounts,
} = require('../services/sustainability-accounts.service');
function createSustainabilityRouter({ db, auth, options = {} }) {
  const router = express.Router(),
    service = createSustainabilityAccounts({ db, auth, ...options });
  const wrap = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res)).catch(next);
  router.post(
    '/invitations/validate',
    wrap(async (req, res) =>
      res.json(await service.validateInvitation(req.body.token))
    )
  );
  // A working email landing page also supports mobile builds without universal links.
  // Tokens stay out of subresource referrers and the browser must not cache invite details.
  router.get(
    '/join',
    wrap(async (req, res) => {
      res.set({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow',
      });
      const value = await service.validateInvitation(req.query.token);
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
      res
        .set({
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Robots-Tag': 'noindex, nofollow',
        })
        .type('html')
        .send(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Join iampuviyan Partner</title><style>body{background:#1a1a1a;color:#fff;font:16px system-ui;padding:32px;line-height:1.6}main{max-width:480px;margin:48px auto}small{color:#48c84f;letter-spacing:3px}textarea{box-sizing:border-box;width:100%;padding:14px;background:#232323;color:#fff;border:1px solid #48c84f;border-radius:8px;word-break:break-all}p{color:#ccc}</style></head><body><main><small>IAMPuVIYAN PARTNER</small><h1>You’re invited</h1><p>Join ${escape(value.organisation.name)} as an organisation ${value.role === 'org_admin' ? 'admin' : 'analyst'}.</p><p>Open <strong>iampuviyan Partner</strong>, choose <strong>I have an invitation</strong>, and paste this invitation token to create your email/password account.</p><textarea aria-label="Invitation token" readonly rows="3">${escape(req.query.token)}</textarea><p>Use ${escape(value.email)} when signing up. This invitation can be used once and expires on ${escape(value.expiresAt.slice(0, 10))}.</p></main></body></html>`
        );
    })
  );
  router.use((req, _res, next) =>
    Promise.resolve()
      .then(async () => {
        const token = /^Bearer (\S+)$/.exec(
          req.headers.authorization || ''
        )?.[1];
        if (!token) fail(401, 'Please sign in to continue.');
        let d;
        try {
          d = await auth.verifyIdToken(token, true);
        } catch (_) {
          fail(401, 'Your session has expired. Sign in again.');
        }
        req.identity = {
          uid: d.uid,
          email: d.email || '',
          signInProvider: d.firebase?.sign_in_provider,
        };
      })
      .then(() => next(), next)
  );
  router.post(
    '/registrations',
    wrap(async (req, res) => {
      const result = await service.register(req.identity, req.body);
      res.status(result.created ? 201 : 200).json(result);
    })
  );
  router.get(
    '/account',
    wrap(async (req, res) => res.json(await service.account(req.identity)))
  );
  router.patch(
    '/account',
    wrap(async (req, res) =>
      res.json(await service.profile(req.identity, req.body))
    )
  );
  router.get(
    '/members',
    wrap(async (req, res) => res.json(await service.listMembers(req.identity)))
  );
  router.patch(
    '/members/:uid',
    wrap(async (req, res) =>
      res.json(
        await service.updateMember(req.identity, req.params.uid, req.body)
      )
    )
  );
  router.get(
    '/invitations',
    wrap(async (req, res) =>
      res.json(await service.listInvitations(req.identity))
    )
  );
  router.post(
    '/invitations',
    wrap(async (req, res) =>
      res.status(201).json(await service.invite(req.identity, req.body))
    )
  );
  router.post(
    '/invitations/:id/renew',
    wrap(async (req, res) =>
      res.json(
        await service.changeInvitation(req.identity, req.params.id, false)
      )
    )
  );
  router.post(
    '/invitations/:id/revoke',
    wrap(async (req, res) =>
      res.json(
        await service.changeInvitation(req.identity, req.params.id, true)
      )
    )
  );
  router.post(
    '/invitations/accept',
    wrap(async (req, res) =>
      res
        .status(201)
        .json(await service.acceptInvitation(req.identity, req.body))
    )
  );
  return router;
}
module.exports = { createSustainabilityRouter };
