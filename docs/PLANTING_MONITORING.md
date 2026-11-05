# Planting evidence and growth monitoring (v2)

The partner app can create planting records for seeds/planting spots, saplings, and established trees, then append dated follow-up observations. Records are scoped to a `plant_trees` project and retain the project organisation and optional event.

## Ground evidence

- `POST /partner-app/projects/:projectId/plantings/captures` creates a 15-minute, single-use capture session. For a follow-up pass `plantingId`.
- `POST /partner-app/projects/:projectId/plantings` accepts multipart `metadata`, `photo` (close-up), and `contextPhoto` (wide planting-area view).
- `POST /partner-app/projects/:projectId/plantings/:plantingId/observations` appends a follow-up observation with the same multipart fields.
- `GET /partner-app/projects/:projectId/plantings/:plantingId` returns the planting, chronological observation history, signed photo URLs, due state and reviewed measurements.
- `GET /partner-app/projects/:projectId/plantings/nearby?latitude=...&longitude=...&radiusMeters=...` returns project-local planting pins within 1 km maximum.
- `POST /partner-app/projects/:projectId/plantings/:plantingId/observations/:observationId/review` accepts `approved`, `rejected`, or `more_evidence`, a revision and a reviewer note.
- `PATCH /partner-app/projects/:projectId/plantings/:plantingId/schedule` changes the follow-up interval using optimistic revision control.

Capture metadata includes a random 32-hex `recordId`, session ID, capture and location timestamps, coordinate, horizontal accuracy, camera source, notes, stage, and optional measured height. Baselines also include kind, species/unknown, seed count and check interval. At baseline, the app requires a close-up and context image. Follow-ups are time ordered, must be within 25 m of the registered point, and are flagged when location matching is uncertain.

Guardrails include fresh single-use server sessions, camera-only capture for v2, ≤10 m reported GPS accuracy, 24-hour timestamp bounds, minimum photo dimensions, duplicate SHA-256 image rejection, perceptual similarity flags, and a transactionally maintained 5 m geospatial exclusion index. Existing registered coordinates within five metres reject a new registration. The index is global across projects to reduce duplicate entries; nearby lookup only reveals pins within the caller's project. Before rollout, migrate existing staging tree records with `FIREBASE_PROJECT_ID=puviyan-stage FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/stage-service-account.json node scripts/backfill-planting-location-index.js` (dry-run), review its counts, then rerun with `--apply`. The script refuses any project except `puviyan-stage`. Phone location and AI are not tamper-proof evidence. GPS uncertainty is surfaced for reviewers; the app must not describe the check as proof that an unregistered physical tree is absent.

All photos are re-encoded and held in the private partner photo bucket. Only the API mints 15-minute read URLs. Firestore root and observation documents retain their registered location, stage, capture actor, audit state and due schedule; image paths, hashes and capture tokens are omitted from client responses.

## Review and AI

AI photo assessment is an optional Gemini visual-check adapter and Pl@ntNet species-identification adapter (`src/services/planting-photo-assessment.service.js`). It is disabled unless `PLANTING_AI_ENABLED=true` and `GEMINI_API_KEY` are configured. `PLANTING_AI_MODEL` defaults to `gemini-2.5-flash-lite`; `PLANTNET_API_KEY` enables species suggestions for visible saplings/trees (`PLANTNET_PROJECT` defaults to `all`). `PLANTING_AI_DAILY_LIMIT` defaults to 500 provider calls/day across both services and is enforced by a Firestore usage counter before calls. Missing keys, cap exhaustion, provider errors or malformed output leave the record saved and pending human review. The model may return visible-plant, stage, image-quality flags and species suggestions, but never approves evidence, sets coordinates, or records growth measurements. A different organisation reviewer must approve, reject or request more evidence; the API requires a note and records an audit entry.

Do not enable the paid providers until the project owner has supplied/created the required restricted API key(s) in Secret Manager and accepted the billing/usage cap. The default staging service has no keys and AI remains off.

## Remote site imagery

- `GET /partner-app/projects/:projectId/plantings/remote-imagery`
- `POST /partner-app/projects/:projectId/plantings/remote-imagery` accepts a source (`satellite`, `drone`, `fixed_camera`), capture date, source name, `[west,south,east,north]` footprint, optional resolution, record ID, notes and one preview image.

This first implementation stores and displays team-uploaded imagery only. It does not order satellite collections, ingest provider APIs, or derive vegetation indices. Remote imagery is explicitly labeled `site_context_only` and `not_individual_plant_verification`. Satellite/drone connection work requires a provider, geography, revisit interval and licensing agreement. Sentinel-2 data is useful for broader site change, not an individual small sapling.

## Existing API compatibility

The legacy `POST /projects/:id/trees` endpoint remains available for older app builds. New v2 uploads use the monitoring routes and data model. Migrate/annotate legacy records separately; do not infer historical approval from `verificationStatus: submitted`.
