#!/bin/bash

# Deploy Firestore Indexes Script
# This script deploys the indexes defined in firestore.indexes.json

set -e

echo "🔥 Deploying Firestore Indexes..."

# Check if Firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI not found. Installing..."
    npm install -g firebase-tools
fi

# Check if firestore.indexes.json exists
if [ ! -f "firestore.indexes.json" ]; then
    echo "❌ firestore.indexes.json not found!"
    exit 1
fi

# Get the environment (default to staging)
ENV=${1:-staging}

echo "📋 Environment: $ENV"

# Set the Firebase project based on environment
if [ "$ENV" = "production" ]; then
    PROJECT_ID="puviyan-prod"
elif [ "$ENV" = "staging" ]; then
    PROJECT_ID="puviyan-stage"
else
    echo "❌ Invalid environment. Use 'staging' or 'production'"
    exit 1
fi

echo "🎯 Target Project: $PROJECT_ID"

# Deploy indexes
echo "🚀 Deploying indexes to $PROJECT_ID..."
firebase deploy --only firestore:indexes --project $PROJECT_ID

echo "✅ Firestore indexes deployed successfully!"
echo ""
echo "📊 Index creation may take a few minutes to complete."
echo "   Check status at: https://console.firebase.google.com/project/$PROJECT_ID/firestore/indexes"
