# Planting evidence and growth monitoring (v2)

Tree carbon estimates follow the PIA MVP methodology in [PIA_TREE_CARBON_IMPACT.md](PIA_TREE_CARBON_IMPACT.md). A follow-up observation may include a non-negative whole-number `survivingCount`. It becomes the latest PIA survival count only after an organisation reviewer approves it; terminal approved stages (`dead`, `missing`, `harvested`, `removed`) set the count to zero. A count above the planted count is retained for review and excluded from carbon totals as a data error.

The partner app can create planting records for seeds/planting spots, saplings, and established trees, then append dated follow-up observations. Records are scoped to a `plant_trees` project and retain the project organisation and optional event.

## Ground evidence

- `POST /partner-app/projects/:projectId/plantings/captures` creates a 15-minute, single-use capture session. For a follow-up pass `plantingId`.
- `POST /partner-app/projects/:projectId/plantings` accepts multipart `metadata` and one `photo` of the plant.
- `POST /partner-app/projects/:projectId/plantings/:plantingId/observations` appends a follow-up observation with the same multipart fields.
- `GET /partner-app/projects/:projectId/plantings/:plantingId` returns the planting, chronological observation history, signed photo URLs, due state and reviewed measurements.
- `GET /partner-app/projects/:projectId/plantings/nearby?latitude=...&longitude=...&radiusMeters=...` returns project-local planting pins within 1 km maximum.
- `POST /partner-app/projects/:projectId/plantings/:plantingId/observations/:observationId/review` accepts `approved`, `rejected`, or `more_evidence`, a revision and a reviewer note.
- `PATCH /partner-app/projects/:projectId/plantings/:plantingId/schedule` changes the follow-up interval using optimistic revision control.

Capture metadata includes a random 32-hex `recordId`, session ID, capture and location timestamps, coordinate, reported horizontal accuracy, location source, target-selection confirmation, optional normalized `selectedTargetPoint` (`x`/`y` from 0 to 1), optional `vegetationCoveragePercent` and `vegetationCoverageOverride`, camera source, notes, stage, and optional measured height. The point is a visual selection from the viewfinder, not a geographic coordinate. The app locks camera zoom at 1× and estimates green-pixel coverage only inside the outlined viewfinder. Below 80%, it asks the user to confirm before capture; an accepted override is stored as a review flag. Gemini assesses the submitted image and is instructed to focus plant identification on the selected target; the full original photo remains the evidence image. Baselines also include kind, optional species, seed count and check interval. The best AI common-name match and top family are saved; users can edit the plant name. Baseline and follow-up submissions each require one photo. Follow-ups are time ordered, remain tied to the original planting coordinates, and compare the detected family with the saved family for reviewer context.

When a project has a saved circular boundary, the API checks baseline and follow-up GPS coordinates against its centre/radius before persisting planting evidence. The same check protects the legacy tree route. New app projects require a boundary from 50 m to 10 km; projects created before this feature remain usable without a boundary.

Guardrails include fresh single-use server sessions, camera-only capture for v2, ≤20 m reported GPS accuracy, 24-hour timestamp bounds, minimum photo dimensions, duplicate SHA-256 image rejection, perceptual similarity flags, and the project geospatial index. There is no minimum spacing rule between planting records. A baseline within 2 m of another project record with the same saved plant family is flagged for organisation review; an approving reviewer records a manual override reason and audit entry. Follow-up photos remain linked to their planting record and include a GPS/family identity check. Phone location and AI are not tamper-proof evidence. The camera's live plant-height estimate uses a lightweight foliage/stem color heuristic inside the outlined viewfinder, not a trained plant segmentation model; it is a capture aid and must not be represented as survey-grade proximity proof. Before rollout, migrate existing staging tree records with `FIREBASE_PROJECT_ID=puviyan-stage FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/stage-service-account.json node scripts/backfill-planting-location-index.js` (dry-run), review its counts, then rerun with `--apply`. The script refuses any project except `puviyan-stage`.

All photos are re-encoded and held in the private partner photo bucket. Only the API mints 15-minute read URLs. Firestore root and observation documents retain their registered location, stage, capture actor, audit state and due schedule; image paths, hashes and capture tokens are omitted from client responses.

## Review and AI

AI photo assessment uses Gemini only (`src/services/planting-photo-assessment.service.js`). It is enabled when `PLANTING_AI_ENABLED=true` and `GEMINI_API_KEY` is configured. Gemini checks visible plant content, suggests the single best common plant name and botanical family, and assesses likely growth stage and image quality. Pl@ntNet is disabled; the API does not call it or bind its key. For stages where a plant should be visible, a completed Gemini result that explicitly says no plant is visible blocks saving the photo. An uncertain or unavailable AI result leaves evidence pending human review. `PLANTING_AI_DAILY_LIMIT` defaults to 500 Gemini requests/day and is enforced by a Firestore usage counter before each request. AI results do not prove that planting occurred, approve evidence, set coordinates, or record growth measurements. A different organisation reviewer must approve, reject or request more evidence; the API requires a note and records an audit entry. The latest assessment is copied to the planting record for the project list, together with `updatedAt` and review status.

The mobile camera estimates the share of green pixels inside the outlined viewfinder. Below 80%, the capture remains available but requires explicit user confirmation. Confirmed low-coverage captures store `vegetationCoveragePercent`, `vegetationCoverageOverride`, and the `low_vegetation_coverage_override` review flag on the planting or observation record. This pixel-colour estimate is a capture guide, not an AI plant classifier; Gemini performs the image assessment after upload.

Staging enables Gemini with a limit of 20 Gemini requests per UTC day. A completed Gemini result that explicitly says no plant is visible blocks a new planting or observation before photo storage. Unknown, unavailable or failed AI checks leave the evidence pending organisation review. Production remains outside this deployment script. Keep the key in Secret Manager and review provider billing and quota before increasing the cap.

## Remote site imagery

- `GET /partner-app/projects/:projectId/plantings/remote-imagery`
- `POST /partner-app/projects/:projectId/plantings/remote-imagery` accepts a source (`satellite`, `drone`, `fixed_camera`), capture date, source name, `[west,south,east,north]` footprint, optional resolution, record ID, notes and one preview image.

These remote-imagery routes store and display team-uploaded imagery only and label it `site_context_only` / `not_individual_plant_verification`. The Sentinel-2 vegetation-analysis endpoint is disabled and is not exposed by the partner API.

## Existing API compatibility

The legacy `POST /projects/:id/trees` endpoint remains available for older app builds. New v2 uploads use the monitoring routes and data model. Migrate/annotate legacy records separately; do not infer historical approval from `verificationStatus: submitted`.
