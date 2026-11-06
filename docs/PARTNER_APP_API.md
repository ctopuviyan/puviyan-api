# Partner mobile API

The Flutter `iampuviyan-partner` app uses a separately deployed `puviyan-partner-api-stage` Cloud Run service in GCP project `puviyan-partner-stage` (`https://puviyan-partner-api-stage-sbkl4nndtq-el.a.run.app`). The service is configured to use `puviyan-partner-stage` for Firebase Auth, Firestore, and Storage. It has no dependency on consumer project data. `/health` reports `service=partner`; the rewards route returns 404 as expected.

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

The tree endpoint accepts multipart form data: one `photo` JPEG/PNG file (up to 8 MiB) and a JSON `metadata` field. Metadata includes a 32-character hexadecimal `recordId`, species, optional notes/event ID, latitude, longitude, accuracy in metres, `capturedAt`, `locationCapturedAt`, and `photoSource` (`camera` or `gallery`). Retrying the same record ID and payload returns the saved record; conflicting payloads return 409.

## Existing Firebase connections

The router uses `getPartnerAuth()` for identity and revocation checks. Its default `getFirestore()` is explicitly configured to `puviyan-partner-stage`, so `partnerUsers`, `organizations`, projects, events, and planting records all remain inside the partner project. Consumer-project data and tokens are not used by this service.

Roles are reloaded on every request, merging the legacy `role` with `roles[]`. Active `puviyan_admin` users can select any organisation without needing a default org ID. Other partners remain within their organisation and assigned departments. `org_analyst` alone is read-only; existing admin/staff/partner roles can write. The route factory is dependency-injected for isolated HTTP tests.

Collections are `partnerProjects/{projectId}`, with `events` and `trees` subcollections. Tree objects live at `partner-projects/{orgId}/{projectId}/{recordId}/{attemptId}`. No migration of existing portal or consumer records is required.

## Staging rollout

1. The service is deployed with `./deploy-partner-api.sh stage`; this targets Cloud Run in `puviyan-partner-stage` and sets both Firebase project IDs to that partner project.
2. Firestore-backed routes currently fail because the Cloud Run runtime identity has no Firestore permission. Configure the dedicated runtime identity and narrowly scoped access before end-to-end use.
3. Photo storage is not provisioned. The bucket name currently configured for planting uploads was not found in the partner project, and the default profile-image bucket is also absent. Approve a private bucket design before enabling uploads; tree photo links use temporary signed URLs.
4. The Flutter staging config now targets `https://puviyan-partner-api-stage-sbkl4nndtq-el.a.run.app/api/v1`. Signup calls use the root paths; project and tree calls append `/partner-app` automatically.

Photo storage is resolved lazily. Missing `PARTNER_TREE_PHOTO_BUCKET` returns 503 on photo operations; it does not prevent API startup, existing endpoints, or empty project/event operations. No service-account key belongs in the mobile app. Keep direct mobile Firestore/Storage access denied for the project records and photo paths.

The service is deployed, but Firestore access and photo storage are pending. No production service is being deployed. Firebase mobile registration and real-device login/camera/GPS checks are still required. Lists currently cap at 500 records and offline capture persistence is not implemented.

## Local verification

```bash
npm run test:partner-app
```

These tests use in-memory Firebase substitutes and temporary localhost HTTP servers. They cover partner-only authentication, revoked/inactive access, multiple/legacy roles, super admins without an org, organisation and department isolation, read-only roles, project/event validation, private photo links, retry safety, and isolation from neighbouring consumer and portal routes. They do not access live Firebase.

Account/profile, user roles, invitation lifecycle, approvals and organisation settings are documented in [Partner management](PARTNER_MANAGEMENT.md).
