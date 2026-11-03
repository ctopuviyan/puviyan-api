# Partner mobile API

The Flutter `iampuviyan-partner` app uses the existing `puviyan-api` deployment. There is no separate partner mobile backend to deploy.

## Routes

All paths below are relative to `/api/v1` (or the configured `API_VERSION`). Existing `/partner`, consumer, signup, and upload endpoints are unchanged.

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

The router uses `getPartnerAuth()` for identity and revocation checks, and `getFirestore()` for the existing data project containing `partnerUsers` and `organizations`. It does not initialize new Firebase apps or introduce new identity-project credentials. Consumer-project tokens cannot authenticate to this route group, even if a consumer has the same UID as a partner.

Roles are reloaded on every request, merging the legacy `role` with `roles[]`. Active `puviyan_admin` users can select any organisation without needing a default org ID. Other partners remain within their organisation and assigned departments. `org_analyst` alone is read-only; existing admin/staff/partner roles can write. The route factory is dependency-injected for isolated HTTP tests.

Collections are `partnerProjects/{projectId}`, with `events` and `trees` subcollections. Tree objects live at `partner-projects/{orgId}/{projectId}/{recordId}/{attemptId}`. No migration of existing portal or consumer records is required.

## Staging rollout

1. Use the existing staging `puviyan-api` deployment and its existing staging Firebase credentials and project IDs.
2. Set `PARTNER_TREE_PHOTO_BUCKET` to a **private staging bucket** accessible to the API's current Firebase Admin identity. It may be an existing private bucket; do not select a bucket with public IAM read access. The existing reward image upload service publishes images, so it is deliberately not used for tree evidence.
3. Ensure the runtime identity can read partner users/revocation status, read/write project records, manage photo objects, and sign temporary download URLs. ADC signers may require `iam.serviceAccounts.signBlob`.
4. Deploy these changes to staging through the existing API deployment process.
5. Set the Flutter app's single `API_BASE_URL` to the exact HTTPS `/api/v1` base used by the staging partner portal. Signup calls use the existing root paths; projects and tree uploads append `/partner-app` automatically.

Photo storage is resolved lazily. Missing `PARTNER_TREE_PHOTO_BUCKET` returns 503 on photo operations; it does not prevent API startup, existing endpoints, or empty project/event operations. No service-account key belongs in the mobile app. Keep direct mobile Firestore/Storage access denied for the project records and photo paths.

This change does not itself deploy staging or production, change Firebase users/providers, register the mobile apps, change bucket IAM, or migrate data. Firebase mobile registration and real-device login/camera/GPS checks are still required. Lists currently cap at 500 records and offline capture persistence is not implemented.

## Local verification

```bash
npm run test:partner-app
```

These tests use in-memory Firebase substitutes and temporary localhost HTTP servers. They cover partner-only authentication, revoked/inactive access, multiple/legacy roles, super admins without an org, organisation and department isolation, read-only roles, project/event validation, private photo links, retry safety, and isolation from neighbouring consumer and portal routes. They do not access live Firebase.
