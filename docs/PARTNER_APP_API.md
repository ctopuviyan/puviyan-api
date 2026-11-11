# Partner mobile API

The Flutter `iampuviyan-partner` app uses a separately deployed `puviyan-partner-api-stage` Cloud Run service in GCP project `puviyan-partner-stage` (`https://puviyan-partner-api-stage-sbkl4nndtq-el.a.run.app`). The service uses `puviyan-partner-stage` for Firebase Auth, Firestore, and Storage. It has no dependency on consumer project data. `/health` reports `service=partner`; public organization lookup succeeds; the rewards route returns 404 as expected.

## Routes

All paths below are relative to `/api/v1` (or the configured `API_VERSION`). The partner service exposes its partner app routes and the mobile onboarding/photo-upload endpoints only; consumer rewards and points routes are not mounted.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/partner-app/me` | Current partner roles, organisation, departments, and write permission |
| GET | `/partner-app/organisations` | Super-admin organisation selection |
| GET | `/partner-app/projects?orgId=...` | Projects within the caller's allowed scope |
| POST | `/partner-app/projects` | Create a scoped project |
| GET | `/partner-app/projects/:id` | Project, events, and tree records with temporary photo links |
| POST | `/partner-app/projects/:id/events` | Create an event within a project |
| POST | `/partner-app/projects/:id/trees` | Record a tree with a photo and phone GPS |

New project requests require `startDate` and `endDate` in `YYYY-MM-DD` format, where the end date is on or after the start date. They also include a circular boundary:

```json
{
  "boundary": {
    "center": { "latitude": 13.0827, "longitude": 80.2707 },
    "radiusMeters": 500
  }
}
```

Plant Trees project requests may also include `treeGoal` as a positive integer from 1 to 10,000,000. The API stores it with the project; it is rejected for other project scopes. Older app requests that omit this optional field remain supported.

The centre must contain valid latitude/longitude values and the radius must be 50–10,000 metres. New app project creation requires this selection. The API checks both the legacy tree route and the planting baseline/follow-up routes against the saved boundary. A point outside it is rejected. Existing projects without a boundary remain compatible and do not receive this check until a boundary is added.

The tree endpoint accepts multipart form data: one `photo` JPEG/PNG file (up to 8 MiB) and a JSON `metadata` field. Metadata includes a 32-character hexadecimal `recordId`, species, optional notes/event ID, latitude, longitude, accuracy in metres, `capturedAt`, `locationCapturedAt`, and `photoSource` (`camera` or `gallery`). Retrying the same record ID and payload returns the saved record; conflicting payloads return 409.

## Existing Firebase connections

The router uses `getPartnerAuth()` for identity and revocation checks. Its default `getFirestore()` is explicitly configured to `puviyan-partner-stage`, so `partnerUsers`, `organizations`, projects, events, and planting records all remain inside the partner project. Consumer-project data and tokens are not used by this service.

Roles are reloaded on every request, merging the legacy `role` with `roles[]`. Active `puviyan_admin` users can select any organisation without needing a default org ID. Other partners remain within their organisation and assigned departments. `org_analyst` alone is read-only; existing admin/staff/partner roles can write. The route factory is dependency-injected for isolated HTTP tests.

Sustainability v2 registration stores each organisation's line of business and creates a short name-based org ID with a uniqueness suffix. Admin and analyst invitations are scoped to that org ID. An owner invitation is an explicit transfer: acceptance promotes the invitee, deactivates the former owner, updates the single-owner reference, and disables the former owner's Firebase sign-in while retaining the membership and audit records.

Service-provider registration requires a service category (`NGO services`, `ESG services`, or `Environmental services`). Provider organisations use the same single-owner/admin/analyst structure; owners can invite admins and analysts into their own organisation. Action-owner organisations can find existing provider owners with `GET /partner-app/v2/providers/search?q=...` and add them directly with `POST /partner-app/v2/collaborators` (`providerOrgId`, `access: read|write`). This adds an org-scoped collaboration without creating a signup invitation. Collaborators can be listed with `GET /partner-app/v2/collaborators`, updated or revoked with `PATCH /partner-app/v2/collaborators/:providerOrgId`. Provider owners and admins can write to a collaborating organisation's projects only when granted write access; provider analysts always remain read-only. Server-side project and planting access checks enforce this scope.

The v2 app signup and invitation flows require email OTP verification. `POST /partner-app/v2/email-verification/send` accepts `{ email }` for registration or `{ email, invitationToken }` for an existing invite. `POST /partner-app/v2/email-verification/verify` accepts `{ email, code }` with the same optional invitation token and returns a short-lived `verificationToken` plus password-provider availability for the verified address. The client blocks Google-only accounts with a clear message; existing password accounts can continue using their current password. Registration must include the verification token as `emailVerificationToken`; invitation acceptance must also include it and the API binds it to the invitation ID. Codes expire after 10 minutes, allow five verification attempts, and are rate-limited to one send per minute and five sends per hour. Verification tokens are single-use.

Collections are `partnerProjects/{projectId}`, with `events` and `trees` subcollections. Tree objects live at `partner-projects/{orgId}/{projectId}/{recordId}/{attemptId}`. No migration of existing portal or consumer records is required.

## Staging rollout

1. The service is deployed with `./deploy-partner-api.sh stage`; it targets Cloud Run in `puviyan-partner-stage` and sets both Firebase project IDs to that project.
2. Runtime identity `puviyan-partner-api-runtime@puviyan-partner-stage.iam.gserviceaccount.com` has Firestore and Firebase Auth access in the partner project. Cloud Run skips local dotenv files and uses Application Default Credentials; `.gcloudignore` excludes env and service-account files.
3. Photos use the private bucket `puviyan-partner-stage-partner-photos` in `asia-south1` with uniform bucket-level access and public access prevention. The runtime identity has object access only on that bucket. Profile-image URLs use Firebase download tokens without public ACLs; planting images use temporary signed URLs.
4. The Flutter staging config targets `https://puviyan-partner-api-stage-sbkl4nndtq-el.a.run.app/api/v1`. Signup calls use the root paths; project and tree calls append `/partner-app` automatically.

Photo storage is resolved lazily. Missing `PARTNER_TREE_PHOTO_BUCKET` returns 503 on photo operations; it does not prevent API startup, existing endpoints, or empty project/event operations. No service-account key belongs in the mobile app. Keep direct mobile Firestore/Storage access denied for the project records and photo paths.

The current staging API revision is `puviyan-partner-api-stage-00005-7c9`. The staging SMTP credential should be rotated before real invitation emails are used. No production service is being deployed. Firebase mobile registration and real-device login/camera/GPS checks are still required. Lists currently cap at 500 records and offline capture persistence is not implemented.

## Local verification

```bash
npm run test:partner-app
```

These tests use in-memory Firebase substitutes and temporary localhost HTTP servers. They cover partner-only authentication, revoked/inactive access, multiple/legacy roles, super admins without an org, organisation and department isolation, read-only roles, project/event validation, private photo links, retry safety, and isolation from neighbouring consumer and portal routes. They do not access live Firebase.

Account/profile, user roles, invitation lifecycle, approvals and organisation settings are documented in [Partner management](PARTNER_MANAGEMENT.md).
