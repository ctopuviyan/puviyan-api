# Partner account and administration

These additions extend the existing `/api/v1/partner-app` route group and use the same partner Firebase identity project and existing data project as the portal.

## Account routes

- `GET /account`: profile, providers, approved partner access, and management capability. Also works before onboarding.
- `PATCH /account`: own display name/photo URL only; synchronizes Firebase Auth, `partnerUsers`, and the legacy `partner_users` profile record.
- `GET /account/requests`: own signup/role-request status, keyed to the verified identity email.
- `POST /account/role-requests`: request additional non-super-admin roles for the current organisation.
- `POST /account/complete-signup`: accept an invitation with a matching authenticated partner identity.

Password changes use Firebase reauthentication and password update from the mobile client. Email is displayed read-only, matching the portal. Profile/logo image uploads reuse the portal's existing public `/upload/image` endpoint; tree photos remain private on their separate path.

## Administration routes

- `GET /management/users?orgId=...`
- `PATCH /management/users/:uid`: approved role array, organisation, organisation/department scope, and active/inactive status. Requires the version returned by the user list.
- `GET|POST /management/invitations`
- `POST /management/invitations/:id`: renew or revoke an unused invitation.
- `GET /management/requests?status=pending|approved|rejected`
- `POST /management/requests/:id/review`: approve/reject signup or additional-role requests.
- `GET|POST /management/organisations`
- `PATCH /management/organisations/:orgId`: organisation name and logo.

Full-organisation `org_admin` and legacy `partner_admin` users administer their own organisation. Department-scoped administrators retain their project permissions but cannot administer organisation-wide identities. `puviyan_admin` can manage all organisations and users without needing a default org ID. Only super admins grant/manage super-admin access or create organisations. Administrators cannot modify their own access or approve their own role requests; another administrator must do so. The actor's current record is rechecked inside mutations, not trusted from a cached client.

Role/status updates use optimistic concurrency, preserve unrelated custom claims, synchronize canonical/legacy records, and disable/revoke Firebase sign-in for inactive users. Partner verification in existing portal middleware now also checks disabled/revoked identities. Reactivated partners sign in again.

## Invitations and approvals

Invitations support multiple roles, scope, seven-day expiry, renewal, revocation, and one-time transactional acceptance. Renewing rotates the token, invalidating the previous URL. Only token hashes are stored in invitation records. Creating/approving returns the authorized administrator a signup URL; the existing request schema retains the approved URL for request tracking. The app can copy the URL or request email delivery. SMTP failure leaves a valid copyable link and is shown distinctly from invitation failure.

`PARTNER_PORTAL_URL` must be a configured HTTPS portal origin for the environment. SMTP settings use the existing email service. Tests opt out of delivery or inject a fake transport; they do not send invitations to real people.

Existing portal `/signup/validate` understands role arrays and revocation. Existing portal `/signup/complete` now uses the same transactional completion and partner-only identity verification. Acceptance checks expiry, revocation, email, active organisation, and existing membership, preserves existing roles/scope, and refuses silent cross-organisation moves. Approval consumes a pending request once and applies additional-role grants without removing existing roles. Administrative changes record an audit entry in `partnerUserAudit`.

Automated checks run with `npm run test:partner-app`. Use isolated, disposable staging users/organisations when testing full native journeys. No consumer or production data migration is required. The existing list limits remain 500 records for management lists and 200 for own-request history; pagination is a follow-up for larger deployments.
