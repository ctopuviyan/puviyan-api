# E2E Testing Guide - Puviyan Rewards System

Complete guide for testing the entire rewards and redemption system.

---

## 🎯 Overview

This guide covers testing all three reward types:
1. **Coupon** - Free items (e.g., "Free Coffee")
2. **Percent Off** - Percentage discount (e.g., "20% off")
3. **Amount Off** - Fixed discount (e.g., "₹50 off")

---

## 📋 Prerequisites

1. Server running: `npm run dev`
2. Firebase configured (staging or prod)
3. Test partner created with API key

---

## 🧪 Test Flow

### Phase 1: Create Rewards (Partner/Admin)

#### Test 1.1: Create Coupon Reward

```bash
curl -X POST http://localhost:8080/api/v1/rewards-management \
  -H "Content-Type: application/json" \
  -d '{
    "rewardTitle": "Free Organic Coffee",
    "rewardSubtitle": "Enjoy a complimentary organic coffee on us",
    "rewardType": "coupon",
    "rewardDetails": [
      "One free organic coffee of any size",
      "Valid at all GreenCafe locations",
      "Made with 100% organic beans"
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
      "Show your coupon code to the barista"
    ],
    "termsAndConditions": "Valid only at participating locations",
    "previewImage": "https://example.com/preview.jpg",
    "carbonContribution": 0.5,
    "categories": ["cafe", "food"]
  }'
```

**Expected Response:**
```json
{
  "rewardId": "reward_abc123",
  "message": "Reward created successfully",
  "rewardType": "coupon",
  "availableCoupons": 100
}
```

#### Test 1.2: Create Percent Off Reward

```bash
curl -X POST http://localhost:8080/api/v1/rewards-management \
  -H "Content-Type: application/json" \
  -d '{
    "rewardTitle": "20% Off Your Purchase",
    "rewardType": "percent_off",
    "brandName": "GreenCafe",
    "deductPoints": 200,
    "discountPercent": 20,
    "maxDiscountAmount": 500,
    "minPurchaseAmount": 1000,
    "maxPerUser": 1,
    "validFrom": "2025-12-30T00:00:00Z",
    "validTo": "2026-02-28T23:59:59Z",
    "status": "active",
    "howToClaim": ["Reserve reward", "Shop minimum ₹1000", "Show QR at checkout"],
    "categories": ["cafe", "discount"]
  }'
```

#### Test 1.3: Create Amount Off Reward

```bash
curl -X POST http://localhost:8080/api/v1/rewards-management \
  -H "Content-Type: application/json" \
  -d '{
    "rewardTitle": "₹50 Off Your Order",
    "rewardType": "amount_off",
    "brandName": "GreenCafe",
    "deductPoints": 100,
    "discountAmount": 50,
    "minPurchaseAmount": 500,
    "maxPerUser": 3,
    "validFrom": "2025-12-30T00:00:00Z",
    "validTo": "2026-01-31T23:59:59Z",
    "status": "active",
    "categories": ["cafe"]
  }'
```

---

### Phase 2: Browse Rewards (User)

#### Test 2.1: Get All Rewards

```bash
curl http://localhost:8080/api/v1/rewards
```

**Expected Response:**
```json
{
  "rewards": [
    {
      "rewardId": "reward_abc123",
      "rewardTitle": "Free Organic Coffee",
      "rewardType": "coupon",
      "deductPoints": 150,
      "availableCoupons": 100
    },
    {
      "rewardId": "reward_def456",
      "rewardTitle": "20% Off Your Purchase",
      "rewardType": "percent_off",
      "discountPercent": 20
    }
  ]
}
```

#### Test 2.2: Filter by Type

```bash
# Get only coupons
curl "http://localhost:8080/api/v1/rewards?rewardType=coupon"

# Get only discounts
curl "http://localhost:8080/api/v1/rewards?rewardType=percent_off"
```

#### Test 2.3: Get Reward Details

```bash
curl http://localhost:8080/api/v1/rewards/reward_abc123
```

---

### Phase 3: Reserve Reward (User)

**Note:** Requires Firebase authentication token

#### Test 3.1: Reserve Coupon

```bash
curl -X POST http://localhost:8080/api/v1/rewards/reserve \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rewardId": "reward_abc123"
  }'
```

**Expected Response:**
```json
{
  "redemptionId": "rdm_xyz789",
  "rewardType": "coupon",
  "couponCode": "GR-XYZ789-ABC",
  "qrToken": "eyJhbGciOiJIUzI1NiIs...",
  "qrCodeUrl": "data:image/png;base64,...",
  "pointsDeducted": 150,
  "expiresAt": "2025-12-31T23:59:59Z",
  "message": "Reward reserved successfully"
}
```

#### Test 3.2: Reserve Percent Off

```bash
curl -X POST http://localhost:8080/api/v1/rewards/reserve \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rewardId": "reward_def456"
  }'
```

**Expected Response:**
```json
{
  "redemptionId": "rdm_abc456",
  "rewardType": "percent_off",
  "couponCode": null,
  "qrToken": "eyJhbGciOiJIUzI1NiIs...",
  "qrCodeUrl": "data:image/png;base64,...",
  "pointsDeducted": 200,
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

---

### Phase 4: Partner Scanning

**Note:** Requires Partner API key

#### Test 4.1: Scan Coupon QR

```bash
curl -X POST http://localhost:8080/api/v1/redemption/scan \
  -H "x-partner-api-key: test_partner_key_12345" \
  -H "Content-Type: application/json" \
  -d '{
    "qrToken": "eyJhbGciOiJIUzI1NiIs..."
  }'
```

**Expected Response (Coupon):**
```json
{
  "redemptionId": "rdm_xyz789",
  "rewardType": "coupon",
  "rewardTitle": "Free Organic Coffee",
  "couponCode": "GR-XYZ789-ABC",
  "status": "active",
  "user": {
    "userId": "user_123",
    "email": "user@example.com"
  },
  "instructions": [
    "Reserve this reward to get your coupon code",
    "Visit any GreenCafe location"
  ]
}
```

**Expected Response (Percent Off):**
```json
{
  "redemptionId": "rdm_abc456",
  "rewardType": "percent_off",
  "rewardTitle": "20% Off Your Purchase",
  "discountPercent": 20,
  "maxDiscountAmount": 500,
  "minPurchaseAmount": 1000,
  "status": "active",
  "user": {
    "userId": "user_123",
    "email": "user@example.com"
  }
}
```

---

### Phase 5: Calculate Discount (For percent_off/amount_off)

#### Test 5.1: Calculate 20% Off

```bash
curl -X POST http://localhost:8080/api/v1/redemption/calculate \
  -H "x-partner-api-key: test_partner_key_12345" \
  -H "Content-Type: application/json" \
  -d '{
    "redemptionId": "rdm_abc456",
    "userId": "user_123",
    "billAmount": 1500
  }'
```

**Expected Response:**
```json
{
  "billAmount": 1500,
  "discountPercent": 20,
  "discountAmount": null,
  "maxDiscountAmount": 500,
  "appliedDiscount": 300,
  "finalAmount": 1200,
  "message": "20% discount applied (₹300 off)"
}
```

#### Test 5.2: Calculate with Max Cap

```bash
# Bill of ₹5000, 20% = ₹1000, but capped at ₹500
curl -X POST http://localhost:8080/api/v1/redemption/calculate \
  -H "x-partner-api-key: test_partner_key_12345" \
  -H "Content-Type: application/json" \
  -d '{
    "redemptionId": "rdm_abc456",
    "userId": "user_123",
    "billAmount": 5000
  }'
```

**Expected Response:**
```json
{
  "billAmount": 5000,
  "appliedDiscount": 500,
  "finalAmount": 4500,
  "message": "20% discount applied (₹500 off) - capped at ₹500"
}
```

---

### Phase 6: Confirm Redemption

#### Test 6.1: Confirm Coupon Redemption

```bash
curl -X POST http://localhost:8080/api/v1/redemption/confirm \
  -H "x-partner-api-key: test_partner_key_12345" \
  -H "Content-Type: application/json" \
  -d '{
    "redemptionId": "rdm_xyz789",
    "userId": "user_123",
    "partnerTransactionId": "pos_order_001"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "redemptionId": "rdm_xyz789",
  "status": "redeemed",
  "message": "Redemption confirmed successfully"
}
```

#### Test 6.2: Confirm Discount Redemption

```bash
curl -X POST http://localhost:8080/api/v1/redemption/confirm \
  -H "x-partner-api-key: test_partner_key_12345" \
  -H "Content-Type: application/json" \
  -d '{
    "redemptionId": "rdm_abc456",
    "userId": "user_123",
    "partnerTransactionId": "pos_order_002",
    "billAmount": 1500,
    "appliedDiscount": 300
  }'
```

---

### Phase 7: User Views Redemptions

```bash
curl http://localhost:8080/api/v1/rewards/my/redemptions \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN"
```

**Expected Response:**
```json
{
  "redemptions": [
    {
      "redemptionId": "rdm_xyz789",
      "rewardTitle": "Free Organic Coffee",
      "rewardType": "coupon",
      "couponCode": "GR-XYZ789-ABC",
      "status": "redeemed",
      "pointsDeducted": 150,
      "redeemedAt": "2025-12-30T15:30:00Z"
    }
  ]
}
```

---

### Phase 8: Reward Analytics

```bash
curl http://localhost:8080/api/v1/rewards-management/reward_abc123/analytics
```

**Expected Response:**
```json
{
  "rewardId": "reward_abc123",
  "rewardTitle": "Free Organic Coffee",
  "rewardType": "coupon",
  "stock": {
    "total": 100,
    "available": 99,
    "redeemed": 1
  },
  "redemptions": {
    "total": 1,
    "reserved": 0,
    "active": 0,
    "redeemed": 1,
    "cancelled": 0
  },
  "points": {
    "totalDeducted": 150,
    "averagePerRedemption": 150
  }
}
```

---

## 🔄 Complete E2E Flow Example

### Scenario: User Redeems "20% Off" Reward

```bash
# 1. Partner creates reward
REWARD_ID=$(curl -s -X POST http://localhost:8080/api/v1/rewards-management \
  -H "Content-Type: application/json" \
  -d '{"rewardTitle":"20% Off","rewardType":"percent_off","brandName":"GreenCafe","deductPoints":200,"discountPercent":20,"maxDiscountAmount":500,"minPurchaseAmount":1000,"validFrom":"2025-12-30T00:00:00Z","validTo":"2026-02-28T23:59:59Z","status":"active"}' \
  | jq -r '.rewardId')

# 2. User browses rewards
curl http://localhost:8080/api/v1/rewards

# 3. User reserves reward (needs Firebase token)
REDEMPTION_ID=$(curl -s -X POST http://localhost:8080/api/v1/rewards/reserve \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"rewardId\":\"$REWARD_ID\"}" \
  | jq -r '.redemptionId')

QR_TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/rewards/reserve \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"rewardId\":\"$REWARD_ID\"}" \
  | jq -r '.qrToken')

# 4. Partner scans QR
curl -X POST http://localhost:8080/api/v1/redemption/scan \
  -H "x-partner-api-key: test_partner_key_12345" \
  -H "Content-Type: application/json" \
  -d "{\"qrToken\":\"$QR_TOKEN\"}"

# 5. Partner calculates discount
curl -X POST http://localhost:8080/api/v1/redemption/calculate \
  -H "x-partner-api-key: test_partner_key_12345" \
  -H "Content-Type: application/json" \
  -d "{\"redemptionId\":\"$REDEMPTION_ID\",\"userId\":\"user_123\",\"billAmount\":1500}"

# 6. Partner confirms redemption
curl -X POST http://localhost:8080/api/v1/redemption/confirm \
  -H "x-partner-api-key: test_partner_key_12345" \
  -H "Content-Type: application/json" \
  -d "{\"redemptionId\":\"$REDEMPTION_ID\",\"userId\":\"user_123\",\"billAmount\":1500,\"appliedDiscount\":300,\"partnerTransactionId\":\"pos_001\"}"

# 7. Check analytics
curl http://localhost:8080/api/v1/rewards-management/$REWARD_ID/analytics
```

---

## ✅ Success Criteria

- [x] Can create all 3 reward types
- [x] Can browse and filter rewards
- [x] Can reserve rewards (points deducted)
- [x] Can scan QR codes
- [x] Can calculate discounts correctly
- [x] Can confirm redemptions
- [x] Can view redemption history
- [x] Analytics show correct data

---

## 🐛 Common Issues

### Issue 1: "Insufficient points"
**Solution:** Add points to test user in `informationsPrivate/{uid}`

### Issue 2: "Invalid partner API key"
**Solution:** Create partner with `create-test-data.js`

### Issue 3: "Reward expired"
**Solution:** Update `validTo` date to future

### Issue 4: "Below minimum purchase"
**Solution:** Ensure bill amount >= `minPurchaseAmount`

---

## 📊 Test Data Setup

```javascript
// Run this to set up test data
node create-test-data.js

// Or manually add points to user
db.collection('informationsPrivate').doc('USER_ID').update({
  points: 1000,
  pointsEarned: 1000,
  pointsRedeemed: 0
});
```

---

## 🎉 Next Steps

After successful E2E testing:
1. Deploy to staging
2. Build Flutter UI
3. Build partner scanning app
4. Add admin dashboard
