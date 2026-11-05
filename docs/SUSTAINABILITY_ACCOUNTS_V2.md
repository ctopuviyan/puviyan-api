# Sustainability organisation accounts (v2)

Base: `/api/v1/partner-app/v2`. These endpoints implement the new partner signup design without replacing the existing portal contracts. Existing organisations remain on their current policy. New organisations and memberships have `membershipVersion: 2`; legacy routes cannot move, replace, or grant roles into them. No automatic data migration is performed.

## Authentication and signup

Use the **partner** Firebase project. Create an email/password identity with the native/client Firebase SDK, then obtain its Firebase ID token. Send that token as `Authorization: Bearer ...` to these APIs. Passwords are handled by Firebase; do not include a password in API request bodies. Google, custom-token sessions and identities linked to non-password providers are rejected for this flow. Do not disable Google globally in the shared Firebase project, since existing portal accounts still use it.

`POST /registrations` creates the organisation and founding membership atomically:

```json
{
  "firstName": "Asha",
  "lastName": "Kumar",
  "title": "Sustainability lead",
  "organisationName": "Green Earth Ltd",
  "accountType": "sustainability_action_owner"
}
```

The two public account types are `sustainability_action_owner` and `sustainability_service_provider`. Admin and analyst are not public signup choices. Email comes from the verified Firebase token and matching Auth user record; an account can complete registration before email verification, as with ordinary Firebase email/password account creation.

The generated organisation ID is a name-derived slug plus a random UUID suffix, for example `green-earth-ltd-<32-hex-characters>`. The server never accepts an org ID supplied by the client. Matching names create separate accounts. The founding user receives its selected account-type role and owns that organisation; invited members share the organisation's ID. Each identity has one organisation membership.

Response: `{created, user, organisation}`. HTTP 201 means created; an identical retry returns HTTP 200 and the original account, even if the first response was lost. A retry cannot change the organisation, account type or founding profile. An existing portal member or invited member cannot bootstrap another organisation using the same identity. If Firebase identity creation succeeds but the API call fails, sign in with that same email/password and retry registration; do not create another identity.

## Permissions

| Membership | Create its own organisation | Invite/manage members | Project actions |
|---|---|---|---|
| Sustainability action owner | Yes, during initial signup | Its own organisation only | Read/write |
| Sustainability service provider | Yes, during initial signup | No | Read/write in its own organisation |
| Organisation admin (`org_admin`) | No; invitation required | No | Read/write in the invited organisation |
| Organisation analyst (`org_analyst`) | No; invitation required | No | Read-only in the invited organisation |

Only action owners may invite or change roles. Every invitation grants **one** of `org_admin` or `org_analyst`; owner/provider/super-admin grants are rejected. The owner can swap admin and analyst roles or deactivate/reactivate members. Organisation and department overrides are not accepted. Ownership cannot be granted through this member-edit API or through an invitation. The last active action owner cannot be demoted or deactivated, including concurrent requests. Existing additional owners, if introduced by a controlled migration, can be managed without violating that invariant. Service-provider accounts have no member-management capability.

## Account and members

- `GET /account`: `{user, organisation, canManageMembers}`.
- `PATCH /account`: own `firstName`, `lastName`, `title`, optional HTTPS `photoURL` or null. Access fields are immutable here.
- `GET /members`: action-owner-only list, capped at 500, with `grantableRoles`.
- `PATCH /members/:uid`: `{role?, status?, version}`. `role` may be `org_admin` or `org_analyst`; `status` may be `active` or `inactive`. Use the integer version returned by the server; stale updates return 409.

Existing `/api/v1/partner-app/me`, `/projects` and project event/tree routes remain the project API. They recognise the new roles, require password sign-in for v2 accounts and enforce organisation scope. `/me` includes `membershipVersion` so the app selects the correct account-management UI. Profile image upload can still use `/api/v1/upload/image`; other legacy portal/account endpoints reject v2 identities. Canonical `partnerUsers` and compatibility `partner_users` records remain in sync; access is always checked against the current canonical record, not cached role claims.

## Email invitations

Set `PARTNER_APP_SIGNUP_URL` to the signup entry URL that supports this version. The API provides an email landing page at:

`https://<api-host>/api/v1/partner-app/v2/join`

This page explains how to open the partner app, select **I have an invitation** and paste the emailed link/token. It requires no client-side script, validates the invitation and prevents caching/referrer disclosure. A future universal-link/signup web page can replace this entry via configuration. Existing SMTP configuration is reused. If the URL is missing or invalid, creation fails with 503 before storing an invitation.

1. Owner calls `POST /invitations` with `{email, role}`. Email delivery is automatic. The server derives the organisation from the owner; it rejects self-invitations and duplicate pending invitations.
2. The response includes `{id, signupUrl, emailSent}`. Email failure preserves the valid invitation and returns an explicit error so the owner can copy the link or renew to retry delivery. No email opt-out is exposed in this flow.
3. `POST /invitations/validate` with `{token}` is public and rate-limited. It returns the intended email, role, organisation and expiry for the signup form.
4. The invited user creates/signs into a Firebase email/password identity matching the invited email, then calls `POST /invitations/accept` with `{token, firstName, lastName, title}`. The server chooses the role and organisation from the invitation. No role/org field is accepted from the invitee.
5. Acceptance atomically creates the membership and consumes the invitation. Used, revoked, expired, wrong-email and cross-organisation attempts are rejected. It cannot modify an existing membership. A Firebase identity with no app membership does not have access to projects.

Other owner-only routes:

- `GET /invitations`: scoped list (500 max), excluding tokens and hashes.
- `POST /invitations/:id/renew`: rotate the unused link, extend expiry and send email again.
- `POST /invitations/:id/revoke`: invalidate an unused link.

Invitations expire after seven days and store only a token hash. An org/email reservation serialises duplicate invitations. Acceptance rechecks the issuer's active ownership inside the transaction; withdrawal of ownership invalidates unused links until an active action owner renews them. Audit records contain membership changes, never passwords or invitation tokens. API request logging redacts `token` query parameters; infrastructure request-log retention/access should follow the deployment's existing policy.

## Mobile design and verification

The partner signup uses the consumer app's dark signup design as reference: compact labelled fields, blur/submit validation, password visibility toggle and a green CTA. It uses two steps for personal and organisation details, with only the two account types. Invited signup locks email, organisation and role to the invitation. The new Account screen shows profile fields and the organisation ID; **Manage team** is exposed only when the API grants it.

Run `npm run test:partner-app` for backend policy and HTTP regression tests. Tests inject email delivery and do not send messages to real recipients. The Flutter project contains form/permissions tests and native staging journeys. Staging fixture users, orgs, membership records, invitations, reservations, audit entries and uploaded images must be removed after live tests. The existing portal approval flow and legacy memberships remain available through their existing clients.
