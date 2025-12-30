#!/bin/bash

# Test script for complete redemption flow
# This demonstrates the full QR-based redemption process

BASE_URL="http://localhost:8080/api/v1"

echo "🧪 Testing Puviyan Redemption API Flow"
echo "========================================"
echo ""

# Note: You need real Firebase tokens and partner API keys to test
# This script shows the structure - replace with actual tokens

FIREBASE_TOKEN="YOUR_FIREBASE_ID_TOKEN_HERE"
PARTNER_API_KEY="YOUR_PARTNER_API_KEY_HERE"

echo "📝 Step 1: User initiates redemption (generates QR)"
echo "---------------------------------------------------"
echo "POST $BASE_URL/redemption/initiate"
echo ""

curl -X POST "$BASE_URL/redemption/initiate" \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "points": 500,
    "partnerId": "partner_xyz"
  }' | python3 -m json.tool

echo ""
echo ""

# Save the response to extract redemptionId and qrToken
# In real scenario, extract these from the response above

REDEMPTION_ID="rdm_123"
QR_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

echo "📱 Step 2: Partner scans QR code"
echo "--------------------------------"
echo "POST $BASE_URL/redemption/scan"
echo ""

curl -X POST "$BASE_URL/redemption/scan" \
  -H "x-partner-api-key: $PARTNER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"qrToken\": \"$QR_TOKEN\"
  }" | python3 -m json.tool

echo ""
echo ""

echo "💳 Step 3: Customer pays, partner confirms redemption"
echo "------------------------------------------------------"
echo "POST $BASE_URL/redemption/confirm"
echo ""

curl -X POST "$BASE_URL/redemption/confirm" \
  -H "x-partner-api-key: $PARTNER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"redemptionId\": \"$REDEMPTION_ID\",
    \"partnerTransactionId\": \"pos_order_456\",
    \"appliedDiscount\": 50
  }" | python3 -m json.tool

echo ""
echo ""

echo "📊 Step 4: User checks redemption history"
echo "-----------------------------------------"
echo "GET $BASE_URL/redemption/history"
echo ""

curl -X GET "$BASE_URL/redemption/history?limit=10" \
  -H "Authorization: Bearer $FIREBASE_TOKEN" | python3 -m json.tool

echo ""
echo ""

echo "✅ Redemption flow test complete!"
echo ""
echo "Note: To run this test with real data:"
echo "1. Get a Firebase ID token from your Flutter app"
echo "2. Create a partner and get their API key"
echo "3. Replace the tokens in this script"
echo "4. Run: bash test-redemption-flow.sh"
