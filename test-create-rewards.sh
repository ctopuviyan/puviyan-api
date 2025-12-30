#!/bin/bash

# Test script for creating all three types of rewards
# This demonstrates the complete reward creation API

BASE_URL="http://localhost:8080/api/v1"

echo "🧪 Testing Reward Creation API"
echo "========================================"
echo ""

# Note: In production, you would need authentication
# For testing, we'll use the API without auth (update routes to allow this for testing)

echo "📝 Test 1: Create COUPON Reward (Free Coffee)"
echo "---------------------------------------------------"
curl -X POST "$BASE_URL/rewards-management" \
  -H "Content-Type: application/json" \
  -d '{
    "rewardTitle": "Free Organic Coffee",
    "rewardSubtitle": "Enjoy a complimentary organic coffee on us",
    "rewardType": "coupon",
    "rewardDetails": [
      "One free organic coffee of any size",
      "Valid at all GreenCafe locations",
      "Made with 100% organic beans",
      "Served in eco-friendly cups"
    ],
    "brandName": "GreenCafe",
    "partnerId": "partner_greencafe_001",
    "deductPoints": 150,
    "totalCoupons": 100,
    "maxPerUser": 2,
    "validFrom": "2025-12-30T00:00:00Z",
    "validTo": "2026-03-31T23:59:59Z",
    "status": "active",
    "howToClaim": [
      "Reserve this reward to get your coupon code",
      "Visit any GreenCafe location",
      "Show your coupon code to the barista",
      "Enjoy your free organic coffee!"
    ],
    "termsAndConditions": "Valid only at participating GreenCafe locations. Cannot be combined with other offers. One redemption per visit.",
    "previewImage": "https://example.com/images/greencafe-preview.jpg",
    "fullImage": "https://example.com/images/greencafe-full.jpg",
    "carbonContribution": 0.5,
    "categories": ["cafe", "food", "sustainable"]
  }' | python3 -m json.tool

echo ""
echo ""

echo "📝 Test 2: Create PERCENT_OFF Reward (20% Off)"
echo "---------------------------------------------------"
curl -X POST "$BASE_URL/rewards-management" \
  -H "Content-Type: application/json" \
  -d '{
    "rewardTitle": "20% Off Your Purchase",
    "rewardSubtitle": "Save on your entire bill",
    "rewardType": "percent_off",
    "rewardDetails": [
      "Get 20% discount on your total bill",
      "Maximum discount of ₹500",
      "Minimum purchase of ₹1000 required",
      "Valid on all menu items"
    ],
    "brandName": "GreenCafe",
    "partnerId": "partner_greencafe_001",
    "deductPoints": 200,
    "discountPercent": 20,
    "maxDiscountAmount": 500,
    "minPurchaseAmount": 1000,
    "maxPerUser": 1,
    "validFrom": "2025-12-30T00:00:00Z",
    "validTo": "2026-02-28T23:59:59Z",
    "status": "active",
    "howToClaim": [
      "Reserve this reward",
      "Shop at GreenCafe (minimum ₹1000)",
      "Show QR code at checkout",
      "Get 20% off (max ₹500)"
    ],
    "termsAndConditions": "Minimum purchase ₹1000. Maximum discount ₹500. Cannot be combined with other offers.",
    "previewImage": "https://example.com/images/20percent-preview.jpg",
    "fullImage": "https://example.com/images/20percent-full.jpg",
    "carbonContribution": 1.0,
    "categories": ["cafe", "discount"]
  }' | python3 -m json.tool

echo ""
echo ""

echo "📝 Test 3: Create AMOUNT_OFF Reward (₹50 Off)"
echo "---------------------------------------------------"
curl -X POST "$BASE_URL/rewards-management" \
  -H "Content-Type: application/json" \
  -d '{
    "rewardTitle": "₹50 Off Your Order",
    "rewardSubtitle": "Instant discount on your purchase",
    "rewardType": "amount_off",
    "rewardDetails": [
      "Get flat ₹50 off on your order",
      "Minimum purchase of ₹500 required",
      "Valid on all items",
      "No maximum discount limit"
    ],
    "brandName": "GreenCafe",
    "partnerId": "partner_greencafe_001",
    "deductPoints": 100,
    "discountAmount": 50,
    "minPurchaseAmount": 500,
    "maxPerUser": 3,
    "validFrom": "2025-12-30T00:00:00Z",
    "validTo": "2026-01-31T23:59:59Z",
    "status": "active",
    "howToClaim": [
      "Reserve this reward",
      "Shop at GreenCafe (minimum ₹500)",
      "Show QR code at checkout",
      "Get ₹50 off instantly"
    ],
    "termsAndConditions": "Minimum purchase ₹500. Cannot be combined with other offers. Valid for dine-in and takeaway.",
    "previewImage": "https://example.com/images/50off-preview.jpg",
    "fullImage": "https://example.com/images/50off-full.jpg",
    "carbonContribution": 0.3,
    "categories": ["cafe", "discount", "quick-save"]
  }' | python3 -m json.tool

echo ""
echo ""

echo "✅ All reward creation tests completed!"
echo ""
echo "Next steps:"
echo "1. Check the responses above for rewardId values"
echo "2. Test browsing: curl $BASE_URL/rewards"
echo "3. Test reserving: curl -X POST $BASE_URL/rewards/reserve (requires auth)"
echo "4. Test partner scanning: curl -X POST $BASE_URL/redemption/scan (requires partner key)"
