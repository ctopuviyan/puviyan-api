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

The tree endpoint accepts multipart form data: one `photo` JPEG/PNG file (up to 8 MiB) and a JSON `metadata` field. Metadata includes a 32-character hexadecimal `recordId`, species, optional notes/event ID, latitude, longitude, accuracy in metres, `capturedAt`, `locationCapturedAt`, and `photoSource` (`camera` or `gallery`). Retrying the same record ID and payload returns the saved record; conflicting payloads return 409.

## Existing Firebase connections

The router uses `getPartnerAuth()` for identity and revocation checks. Its default `getFirestore()` is explicitly configured to `puviyan-partner-stage`, so `partnerUsers`, `organizations`, projects, events, and planting records all remain inside the partner project. Consumer-project data and tokens are not used by this service.

Roles are reloaded on every request, merging the legacy `role` with `roles[]`. Active `puviyan_admin` users can select any organisation without needing a default org ID. Other partners remain within their organisation and assigned departments. `org_analyst` alone is read-only; existing admin/staff/partner roles can write. The route factory is dependency-injected for isolated HTTP tests.

Collections are `partnerProjects/{projectId}`, with `events` and `trees` subcollections. Tree objects live at `partner-projects/{orgId}/{projectId}/{recordId}/{attemptId}`. No migration of existing portal or consumer records is required.

## Staging rollout

1. The service is deployed with `./deploy-partner-api.sh stage`; it targets Cloud Run in `puviyan-partner-stage` and sets both Firebase project IDs to that project.
2. Runtime identity `puviyan-partner-api-runtime@puviyan-partner-stage.iam.gserviceaccount.com` has Firestore and Firebase Auth access in the partner project. Cloud Run skips local dotenv files and uses Application Default Credentials; `.gcloudignore` excludes env and service-account files.
3. Photos use the private bucket `puviyan-partner-stage-partner-photos` in `asia-south1` with uniform bucket-level access and public access prevention. The runtime identity has object access only on that bucket. Profile-image URLs use Firebase download tokens without public ACLs; planting images use temporary signed URLs.
4. The Flutter staging config targets `https://puviyan-partner-api-stage-sbkl4nndtq-el.a.run.app/api/v1`. Signup calls use the root paths; project and tree calls append `/partner-app` automatically.

Photo storage is resolved lazily. Missing `PARTNER_TREE_PHOTO_BUCKET` returns 503 on photo operations; it does not prevent API startup, existing endpoints, or empty project/event operations. No service-account key belongs in the mobile app. Keep direct mobile Firestore/Storage access denied for the project records and photo paths.

The current staging API revision is `puviyan-partner-api-stage-00004-bfk`. The staging SMTP credential should be rotated before real invitation emails are used. No production service is being deployed. Firebase mobile registration and real-device login/camera/GPS checks are still required. Lists currently cap at 500 records and offline capture persistence is not implemented.

## Local verification

```bash
npm run test:partner-app
```

These tests use in-memory Firebase substitutes and temporary localhost HTTP servers. They cover partner-only authentication, revoked/inactive access, multiple/legacy roles, super admins without an org, organisation and department isolation, read-only roles, project/event validation, private photo links, retry safety, and isolation from neighbouring consumer and portal routes. They do not access live Firebase.

Account/profile, user roles, invitation lifecycle, approvals and organisation settings are documented in [Partner management](PARTNER_MANAGEMENT.md).
