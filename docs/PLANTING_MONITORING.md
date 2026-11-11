# Planting evidence and growth monitoring (v2)

The partner app can create planting records for seeds/planting spots, saplings, and established trees, then append dated follow-up observations. Records are scoped to a `plant_trees` project and retain the project organisation and optional event.

## Ground evidence

- `POST /partner-app/projects/:projectId/plantings/captures` creates a 15-minute, single-use capture session. For a follow-up pass `plantingId`.
- `POST /partner-app/projects/:projectId/plantings` accepts multipart `metadata` and one `photo` of the plant.
- `POST /partner-app/projects/:projectId/plantings/:plantingId/observations` appends a follow-up observation with the same multipart fields.
- `GET /partner-app/projects/:projectId/plantings/:plantingId` returns the planting, chronological observation history, signed photo URLs, due state and reviewed measurements.
- `GET /partner-app/projects/:projectId/plantings/nearby?latitude=...&longitude=...&radiusMeters=...` returns project-local planting pins within 1 km maximum.
- `POST /partner-app/projects/:projectId/plantings/:plantingId/observations/:observationId/review` accepts `approved`, `rejected`, or `more_evidence`, a revision and a reviewer note.
- `PATCH /partner-app/projects/:projectId/plantings/:plantingId/schedule` changes the follow-up interval using optimistic revision control.

Capture metadata includes a random 32-hex `recordId`, session ID, capture and location timestamps, coordinate, horizontal accuracy, camera source, notes, stage, and optional measured height. Baselines also include kind, optional species, seed count and check interval. Species can be confirmed later from AI suggestions on the planting record. Baseline and follow-up submissions each require one plant photo. Follow-ups are time ordered, must be within 25 m of the registered point, and are flagged when location matching is uncertain.

When a project has a saved circular boundary, the API checks baseline and follow-up GPS coordinates against its centre/radius before persisting planting evidence. The same check protects the legacy tree route. New app projects require a boundary from 50 m to 10 km; projects created before this feature remain usable without a boundary.

Guardrails include fresh single-use server sessions, camera-only capture for v2, ≤20 m reported GPS accuracy, 24-hour timestamp bounds, minimum photo dimensions, duplicate SHA-256 image rejection, perceptual similarity flags, and a transactionally maintained 5 m geospatial exclusion index. Existing registered coordinates within five metres reject a new registration. The index is global across projects to reduce duplicate entries; nearby lookup only reveals pins within the caller's project. Before rollout, migrate existing staging tree records with `FIREBASE_PROJECT_ID=puviyan-stage FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/stage-service-account.json node scripts/backfill-planting-location-index.js` (dry-run), review its counts, then rerun with `--apply`. The script refuses any project except `puviyan-stage`. Phone location and AI are not tamper-proof evidence. GPS uncertainty is surfaced for reviewers; the app must not describe the check as proof that an unregistered physical tree is absent.

All photos are re-encoded and held in the private partner photo bucket. Only the API mints 15-minute read URLs. Firestore root and observation documents retain their registered location, stage, capture actor, audit state and due schedule; image paths, hashes and capture tokens are omitted from client responses.

## Review and AI

AI photo assessment is an optional Gemini visual-check adapter and Pl@ntNet species-identification adapter (`src/services/planting-photo-assessment.service.js`). Both providers remain off unless `PLANTING_AI_ENABLED=true`; Gemini also requires `GEMINI_API_KEY`, while Pl@ntNet requires `PLANTNET_API_KEY`. `PLANTING_AI_MODEL` defaults to `gemini-2.5-flash-lite`; Pl@ntNet returns species and botanical-family suggestions for eligible visible saplings/trees (`PLANTNET_PROJECT` defaults to `all`). Both providers assess the one submitted plant photo. Gemini checks whether a plant is visible and its likely growth stage. For stages where a plant should be visible, a completed Gemini result that explicitly says no plant is visible blocks saving the photo. An uncertain or unavailable AI result leaves evidence pending human review. `PLANTING_AI_DAILY_LIMIT` defaults to 500 provider calls/day across both services and is enforced by a Firestore usage counter before calls. AI results do not approve evidence, set coordinates, or record growth measurements. A different organisation reviewer must approve, reject or request more evidence; the API requires a note and records an audit entry. The latest assessment is copied to the planting record for the project list, together with `updatedAt` and review status.

Staging enables both providers with a limit of 20 provider calls per UTC day (at most 10 eligible plant submissions when both providers run). A completed Gemini result that explicitly says no plant is visible blocks a new planting or observation before photo storage. Unknown, unavailable or failed AI checks leave the evidence pending organisation review. Production remains outside this deployment script. Keep a restricted key in Secret Manager and review provider billing and quota before increasing the cap.

## Remote site imagery

- `GET /partner-app/projects/:projectId/plantings/remote-imagery`
- `POST /partner-app/projects/:projectId/plantings/remote-imagery` accepts a source (`satellite`, `drone`, `fixed_camera`), capture date, source name, `[west,south,east,north]` footprint, optional resolution, record ID, notes and one preview image.

This first implementation stores and displays team-uploaded imagery only. It does not order satellite collections, ingest provider APIs, or derive vegetation indices. Remote imagery is explicitly labeled `site_context_only` and `not_individual_plant_verification`. Satellite/drone connection work requires a provider, geography, revisit interval and licensing agreement. Sentinel-2 data is useful for broader site change, not an individual small sapling.

## Existing API compatibility

The legacy `POST /projects/:id/trees` endpoint remains available for older app builds. New v2 uploads use the monitoring routes and data model. Migrate/annotate legacy records separately; do not infer historical approval from `verificationStatus: submitted`.
