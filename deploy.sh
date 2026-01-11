#!/bin/bash

# Deployment script for Puviyan API
# Usage: ./deploy.sh [stage|prod]

set -e

ENVIRONMENT=$1

if [ -z "$ENVIRONMENT" ]; then
  echo "❌ Error: Environment not specified"
  echo "Usage: ./deploy.sh [stage|prod]"
  exit 1
fi

if [ "$ENVIRONMENT" != "stage" ] && [ "$ENVIRONMENT" != "prod" ]; then
  echo "❌ Error: Invalid environment. Use 'stage' or 'prod'"
  exit 1
fi

echo "🚀 Starting deployment to $ENVIRONMENT..."

# Check if required files exist
if [ "$ENVIRONMENT" == "stage" ]; then
  ENV_FILE=".env.stage"
  SERVICE_ACCOUNT="service-account-stage.json"
  PROJECT_ID="puviyan-stage"
elif [ "$ENVIRONMENT" == "prod" ]; then
  ENV_FILE=".env.production"
  SERVICE_ACCOUNT="service-account-prod.json"
  PROJECT_ID="puviyan-prod"
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Error: $ENV_FILE not found"
  exit 1
fi

if [ ! -f "$SERVICE_ACCOUNT" ]; then
  echo "❌ Error: $SERVICE_ACCOUNT not found"
  exit 1
fi

echo "✅ Environment files verified"

# Load environment variables from env file
set -a
source "$ENV_FILE"
set +a

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# Run tests (optional)
# echo "🧪 Running tests..."
# npm test

# Deploy based on platform
echo "🚀 Deploying to $ENVIRONMENT..."

# If using Google Cloud Run
if command -v gcloud &> /dev/null; then
  echo "Deploying to Cloud Run..."
  
  gcloud run deploy puviyan-api-$ENVIRONMENT \
    --source . \
    --platform managed \
    --region asia-south1 \
    --project $PROJECT_ID \
    --set-env-vars NODE_ENV=$ENVIRONMENT,FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID,PARTNER_FIREBASE_PROJECT_ID=$PARTNER_FIREBASE_PROJECT_ID,ORG_INVITE_CODE_SALT=$ORG_INVITE_CODE_SALT \
    --allow-unauthenticated \
    --max-instances 10 \
    --memory 512Mi \
    --timeout 60
    
  echo "✅ Deployed to Cloud Run"
fi

# If using App Engine
# gcloud app deploy --project $PROJECT_ID --version $ENVIRONMENT

# If using Firebase Functions
# firebase deploy --only functions --project $PROJECT_ID

echo "✅ Deployment to $ENVIRONMENT completed successfully!"
echo "🔗 Check your deployment at: https://console.cloud.google.com/run?project=$PROJECT_ID"
