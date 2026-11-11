#!/usr/bin/env bash
# Deploy the isolated Partner App API inside the partner Firebase/GCP staging project.
# Usage: ./deploy-partner-api.sh stage
set -euo pipefail

ENVIRONMENT="${1:-}"
if [[ "$ENVIRONMENT" != "stage" ]]; then
  echo "Usage: ./deploy-partner-api.sh stage" >&2
  echo "Production deployment is intentionally not enabled in this script." >&2
  exit 2
fi

ENV_FILE=".env.stage"
PROJECT_ID="puviyan-partner-stage"
SERVICE_NAME="puviyan-partner-api-stage"
REGION="asia-south1"
PHOTO_BUCKET="${PARTNER_TREE_PHOTO_BUCKET:-puviyan-partner-stage-partner-photos}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi
if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI is required." >&2
  exit 1
fi

# Build a temporary env-vars file without printing secret values or placing them
# in gcloud's process arguments. Local service-account file paths are excluded;
# Cloud Run uses its runtime identity and Application Default Credentials.
ENV_VARS_FILE="$(mktemp)"
chmod 600 "$ENV_VARS_FILE"
trap 'rm -f "$ENV_VARS_FILE"' EXIT
ENV_SOURCE_FILE="$ENV_FILE" ENV_OUTPUT_FILE="$ENV_VARS_FILE" PHOTO_BUCKET="$PHOTO_BUCKET" node <<'NODE'
const fs = require('fs');
const dotenv = require('dotenv');
const source = fs.readFileSync(process.env.ENV_SOURCE_FILE, 'utf8');
const parsed = dotenv.parse(source);
const keys = [
  'API_VERSION', 'PARTNER_FIREBASE_PROJECT_ID',
  'ORG_INVITE_CODE_SALT', 'PARTNER_API_KEY_SALT', 'PARTNER_PORTAL_URL',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD',
  'JWT_SECRET', 'JWT_EXPIRY', 'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX_REQUESTS',
  'PARTNER_APP_SIGNUP_URL'
];
for (const key of ['PARTNER_FIREBASE_PROJECT_ID', 'ORG_INVITE_CODE_SALT']) {
  if (!parsed[key]) throw new Error(`${key} missing in ${process.env.ENV_SOURCE_FILE}`);
}
const env = {};
for (const key of keys) if (parsed[key] !== undefined) env[key] = parsed[key];
Object.assign(env, {
  NODE_ENV: 'staging',
  API_SERVICE_SURFACE: 'partner',
  FIREBASE_PROJECT_ID: 'puviyan-partner-stage',
  PARTNER_FIREBASE_PROJECT_ID: 'puviyan-partner-stage',
  FIREBASE_STORAGE_BUCKET: process.env.PHOTO_BUCKET,
  PARTNER_TREE_PHOTO_BUCKET: process.env.PHOTO_BUCKET,
  PARTNER_APP_SIGNUP_URL: 'https://puviyan-partner-api-stage-sbkl4nndtq-el.a.run.app/api/v1/partner-app/v2/join',
  PLANTING_AI_ENABLED: 'false'
});
fs.writeFileSync(process.env.ENV_OUTPUT_FILE, JSON.stringify(env));
NODE

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --platform managed \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --env-vars-file "$ENV_VARS_FILE" \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest,PLANTNET_API_KEY=PLANTNET_API_KEY:latest" \
  --allow-unauthenticated \
  --max-instances 10 \
  --memory 512Mi \
  --timeout 60 \
  --service-account puviyan-partner-api-runtime@puviyan-partner-stage.iam.gserviceaccount.com

echo "Partner API staging deployment completed."
echo "Confirm /health and partner Firebase access before end-to-end app testing."
