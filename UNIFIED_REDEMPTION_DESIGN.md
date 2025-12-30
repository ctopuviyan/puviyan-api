# Unified Redemption System Design for Puviyan

## 📋 Overview

This system handles **3 types of rewards**:
1. **Coupon** - Fixed benefit (e.g., "Free Coffee")
2. **Percent Off** - Percentage discount (e.g., "20% off")
3. **Amount Off** - Fixed discount (e.g., "₹50 off")

---

## 🗂️ Firestore Collections

### 1. `rewards` (EXISTING - Enhanced)

Your current collection with added fields for new reward types:

```javascript
rewards/{rewardId}
{
  // === EXISTING FIELDS (Keep as-is) ===
  rewardTitle: "Free Organic Coffee",
  rewardSubtitle: "Enjoy a complimentary organic coffee on us",
  rewardDetails: ["One free organic coffee...", ...],
  brandName: "GreenCafe",
  deductPoints: 150,
  availableCoupons: 10,
  totalCoupons: 10,
  maxPerUser: 1,
  validFrom: timestamp,
  validTo: timestamp,
  status: "active",
  howToClaim: ["Reserve this reward...", ...],
  previewImage: "url",
  fullImage: "url",
  likeCount: 0,
  dislikeCount: 0,
  usefulnessScore: 600,
  carbonContribution: 0.5,
  createdAt: timestamp,
  updatedAt: timestamp,
  
  // === NEW FIELDS (Add these) ===
  rewardType: "coupon" | "percent_off" | "amount_off",
  
  // For percent_off type
  discountPercent: 20,           // 20% off
  maxDiscountAmount: 500,        // Max ₹500 discount
  minPurchaseAmount: 1000,       // Min purchase ₹1000
  
  // For amount_off type
  discountAmount: 50,            // ₹50 off
  minPurchaseAmount: 500,        // Min purchase ₹500
  
  // Partner linking
  partnerId: "partner_greencafe_001",  // Link to partners collection
  
  // Categories
  categories: ["cafe", "food"],
  
  // Terms
  termsAndConditions: "Cannot be combined with other offers..."
}
```

### 2. `userRedemptions` (NEW)

Tracks user's redemption history and active reservations:

```javascript
userRedemptions/{userId}/redemptions/{redemptionId}
{
  redemptionId: "rdm_abc123",
  userId: "user_xyz",
  rewardId: "reward_greencafe_001",
  
  // Reward snapshot (at time of redemption)
  rewardTitle: "Free Organic Coffee",
  rewardType: "coupon",
  brandName: "GreenCafe",
  partnerId: "partner_greencafe_001",
  
  // Points
  pointsDeducted: 150,
  
  // Coupon details (for coupon type)
  couponCode: "GC-ABC123-XYZ",  // Generated unique code
  
  // Discount details (for percent_off/amount_off)
  discountPercent: 20,
  discountAmount: 50,
  maxDiscountAmount: 500,
  appliedDiscount: 45,  // Actual discount applied
  
  // Status tracking
  status: "reserved" | "active" | "redeemed" | "expired" | "cancelled",
  
  // QR code for scanning
  qrToken: "jwt_token_here",
  qrCodeUrl: "data:image/png;base64,...",  // Generated QR code
  
  // Timestamps
  reservedAt: timestamp,
  activatedAt: timestamp,   // When user activates the reward
  redeemedAt: timestamp,    // When partner confirms redemption
  expiresAt: timestamp,     // Expiry time (e.g., 24 hours from reservation)
  
  // Partner validation
  redeemedBy: "partner_greencafe_001",
  partnerTransactionId: "pos_order_456",
  
  // Metadata
  metadata: {
    userAgent: "mobile-app",
    location: {...}
  }
}
```

### 3. `partners` (NEW)

Partner/brand information:

```javascript
partners/{partnerId}
{
  partnerId: "partner_greencafe_001",
  name: "GreenCafe",
  brandName: "GreenCafe",  // Same as in rewards
  logo: "https://...",
  
  // Location
  locations: [
    {
      locationId: "loc_001",
      address: "123 Main St, Chennai",
      city: "Chennai",
      coordinates: { lat: 13.0827, lng: 80.2707 },
      isActive: true
    }
  ],
  
  // Categories
  categories: ["cafe", "food"],
  
  // API access
  apiKey: "encrypted_key",
  isActive: true,
  
  // Linked rewards
  activeRewards: ["reward_greencafe_001", "reward_greencafe_002"],
  
  // Stats
  stats: {
    totalRedemptions: 150,
    totalPointsRedeemed: 22500
  },
  
  // Timestamps
  createdAt: timestamp,
  updatedAt: timestamp
}
```

---

## 🔄 Redemption Flows by Reward Type

### Flow 1: Coupon Reward (Your Current System)

**User Journey:**
1. Browse rewards → See "Free Coffee" coupon
2. Reserve reward → Deduct 150 points, get coupon code
3. Visit store → Show coupon code to staff
4. Staff validates → Redeem coupon

**API Flow:**
```
POST /api/v1/rewards/reserve
  → Deduct points
  → Generate coupon code
  → Create redemption record
  → Return coupon code

GET /api/v1/rewards/my-redemptions
  → Show active coupons

POST /api/v1/redemption/scan (Partner)
  → Validate coupon code
  → Mark as used

POST /api/v1/redemption/confirm (Partner)
  → Confirm redemption
```

### Flow 2: Percent Off Reward (NEW)

**User Journey:**
1. Browse rewards → See "20% off" reward
2. Reserve reward → Deduct points, get QR code
3. Shop at store → Make purchase
4. Show QR → Partner scans
5. Partner calculates → 20% off (max ₹500)
6. Customer pays → Partner confirms
7. Redemption complete

**API Flow:**
```
POST /api/v1/rewards/reserve
  → Deduct points
  → Generate QR token
  → Create redemption record

POST /api/v1/redemption/scan (Partner)
  → Validate QR
  → Return discount details

POST /api/v1/redemption/calculate (Partner)
  → Calculate discount based on bill
  → Return final amount

POST /api/v1/redemption/confirm (Partner)
  → Apply discount
  → Mark as redeemed
```

### Flow 3: Amount Off Reward (NEW)

**User Journey:**
Same as Percent Off, but with fixed amount discount

**API Flow:**
Same as Percent Off

---

## 🎯 Complete API Specification

### User-Facing APIs

#### 1. Get Available Rewards
```http
GET /api/v1/rewards?category=cafe&rewardType=coupon&status=active

Response 200:
{
  "rewards": [
    {
      "rewardId": "reward_001",
      "rewardTitle": "Free Organic Coffee",
      "rewardType": "coupon",
      "brandName": "GreenCafe",
      "deductPoints": 150,
      "availableCoupons": 10,
      "maxPerUser": 1,
      "validFrom": "2025-12-09T19:00:00Z",
      "validTo": "2026-02-27T19:00:00Z",
      "previewImage": "url",
      "carbonContribution": 0.5
    }
  ],
  "total": 1
}
```

#### 2. Get Reward Details
```http
GET /api/v1/rewards/:rewardId

Response 200:
{
  "rewardId": "reward_001",
  "rewardTitle": "Free Organic Coffee",
  "rewardSubtitle": "Enjoy a complimentary organic coffee on us",
  "rewardType": "coupon",
  "rewardDetails": ["One free organic coffee...", ...],
  "howToClaim": ["Reserve this reward...", ...],
  "brandName": "GreenCafe",
  "partnerId": "partner_greencafe_001",
  "deductPoints": 150,
  "availableCoupons": 10,
  "totalCoupons": 10,
  "maxPerUser": 1,
  "validFrom": "2025-12-09T19:00:00Z",
  "validTo": "2026-02-27T19:00:00Z",
  "termsAndConditions": "...",
  "previewImage": "url",
  "fullImage": "url"
}
```

#### 3. Reserve Reward
```http
POST /api/v1/rewards/reserve
Headers: Authorization: Bearer <FIREBASE_TOKEN>
Body: {
  "rewardId": "reward_001"
}

Response 201:
{
  "redemptionId": "rdm_abc123",
  "rewardType": "coupon",
  "couponCode": "GC-ABC123-XYZ",  // For coupon type
  "qrToken": "jwt_token",
  "qrCodeUrl": "data:image/png;base64,...",
  "pointsDeducted": 150,
  "expiresAt": "2025-12-31T23:59:59Z",
  "message": "Reward reserved successfully"
}

Error 400 - Insufficient Points:
{
  "error": "INSUFFICIENT_POINTS",
  "message": "You need 150 points but have 100"
}

Error 400 - Max Per User Reached:
{
  "error": "MAX_REDEMPTIONS_REACHED",
  "message": "You have already redeemed this reward the maximum number of times"
}

Error 400 - Out of Stock:
{
  "error": "OUT_OF_STOCK",
  "message": "This reward is currently out of stock"
}
```

#### 4. Get My Redemptions
```http
GET /api/v1/rewards/my-redemptions?status=active&limit=20
Headers: Authorization: Bearer <FIREBASE_TOKEN>

Response 200:
{
  "redemptions": [
    {
      "redemptionId": "rdm_abc123",
      "rewardId": "reward_001",
      "rewardTitle": "Free Organic Coffee",
      "rewardType": "coupon",
      "brandName": "GreenCafe",
      "couponCode": "GC-ABC123-XYZ",
      "status": "active",
      "pointsDeducted": 150,
      "reservedAt": "2025-12-30T10:00:00Z",
      "expiresAt": "2025-12-31T23:59:59Z",
      "qrCodeUrl": "data:image/png;base64,..."
    }
  ],
  "total": 1
}
```

#### 5. Cancel Redemption
```http
POST /api/v1/rewards/cancel
Headers: Authorization: Bearer <FIREBASE_TOKEN>
Body: {
  "redemptionId": "rdm_abc123",
  "reason": "Changed my mind"
}

Response 200:
{
  "success": true,
  "pointsRefunded": 150,
  "message": "Redemption cancelled and points refunded"
}
```

---

### Partner-Facing APIs

#### 1. Scan QR Code
```http
POST /api/v1/redemption/scan
Headers: x-partner-api-key: <PARTNER_KEY>
Body: {
  "qrToken": "jwt_token_from_qr_code"
}

Response 200 - Coupon Type:
{
  "redemptionId": "rdm_abc123",
  "rewardType": "coupon",
  "rewardTitle": "Free Organic Coffee",
  "couponCode": "GC-ABC123-XYZ",
  "status": "active",
  "user": {
    "userId": "user_xyz",
    "name": "John Doe"
  },
  "instructions": "Provide one free organic coffee to the customer"
}

Response 200 - Percent Off Type:
{
  "redemptionId": "rdm_abc123",
  "rewardType": "percent_off",
  "rewardTitle": "20% off",
  "discountPercent": 20,
  "maxDiscountAmount": 500,
  "minPurchaseAmount": 1000,
  "status": "active",
  "user": {
    "userId": "user_xyz",
    "name": "John Doe"
  }
}

Response 200 - Amount Off Type:
{
  "redemptionId": "rdm_abc123",
  "rewardType": "amount_off",
  "rewardTitle": "₹50 off",
  "discountAmount": 50,
  "minPurchaseAmount": 500,
  "status": "active",
  "user": {
    "userId": "user_xyz",
    "name": "John Doe"
  }
}
```

#### 2. Calculate Discount
```http
POST /api/v1/redemption/calculate
Headers: x-partner-api-key: <PARTNER_KEY>
Body: {
  "redemptionId": "rdm_abc123",
  "billAmount": 1500
}

Response 200 - Percent Off:
{
  "billAmount": 1500,
  "discountPercent": 20,
  "discountAmount": 300,  // 20% of 1500
  "maxDiscountAmount": 500,
  "appliedDiscount": 300,  // Min of calculated and max
  "finalAmount": 1200,
  "message": "20% discount applied (₹300 off)"
}

Response 200 - Amount Off:
{
  "billAmount": 1500,
  "discountAmount": 50,
  "appliedDiscount": 50,
  "finalAmount": 1450,
  "message": "₹50 discount applied"
}

Error 400 - Below Minimum:
{
  "error": "BELOW_MINIMUM_PURCHASE",
  "message": "Minimum purchase amount is ₹1000"
}
```

#### 3. Confirm Redemption
```http
POST /api/v1/redemption/confirm
Headers: x-partner-api-key: <PARTNER_KEY>
Body: {
  "redemptionId": "rdm_abc123",
  "partnerTransactionId": "pos_order_456",
  "billAmount": 1500,  // For percent_off/amount_off
  "appliedDiscount": 300  // For percent_off/amount_off
}

Response 200:
{
  "success": true,
  "redemptionId": "rdm_abc123",
  "status": "redeemed",
  "message": "Redemption confirmed successfully"
}
```

#### 4. Get Partner Redemptions
```http
GET /api/v1/partners/my-redemptions?startDate=2025-12-01&endDate=2025-12-31
Headers: x-partner-api-key: <PARTNER_KEY>

Response 200:
{
  "redemptions": [
    {
      "redemptionId": "rdm_abc123",
      "rewardTitle": "Free Organic Coffee",
      "rewardType": "coupon",
      "redeemedAt": "2025-12-30T15:30:00Z",
      "partnerTransactionId": "pos_order_456"
    }
  ],
  "stats": {
    "totalRedemptions": 50,
    "totalDiscountGiven": 2500
  }
}
```

---

## 📊 Database Schema Changes

### Changes to Existing `rewards` Collection

**Add these optional fields (backward compatible):**
```javascript
{
  // New reward types
  rewardType: "coupon",  // Default to "coupon" for existing rewards
  
  // For percent_off (optional)
  discountPercent: null,
  maxDiscountAmount: null,
  minPurchaseAmount: null,
  
  // For amount_off (optional)
  discountAmount: null,
  minPurchaseAmount: null,
  
  // Partner linking
  partnerId: null,  // Can be null for now
  
  // Categories
  categories: [],  // Can derive from existing data
  
  // Terms
  termsAndConditions: ""  // Can be empty
}
```

### New Collections to Create

1. **`userRedemptions/{userId}/redemptions/{redemptionId}`** - User's redemption history
2. **`partners/{partnerId}`** - Partner/brand information
3. **`redemptionTransactions/{transactionId}`** - Global transaction log (optional, for analytics)

---

## 🚀 Implementation Priority

### Phase 1: Support Existing Coupon System
- ✅ API to browse rewards (read from existing `rewards` collection)
- ✅ API to reserve coupon (deduct points, generate code)
- ✅ API to view my redemptions
- ✅ API for partner to validate coupon

### Phase 2: Add Percent Off & Amount Off
- ✅ Update `rewards` schema with new fields
- ✅ API to calculate discount
- ✅ API to confirm redemption with discount

### Phase 3: Partner Management
- ✅ Create partners collection
- ✅ Link rewards to partners
- ✅ Partner analytics dashboard

---

## 💡 Key Design Decisions

1. **Backward Compatibility**: Existing `rewards` collection stays intact, just add optional fields
2. **User-Centric Storage**: `userRedemptions` stored under user's document for fast queries
3. **Flexible Reward Types**: Single API handles all 3 types (coupon, percent_off, amount_off)
4. **Two-Phase Commit**: Reserve → Confirm pattern prevents fraud
5. **QR Codes**: All redemptions get QR codes for easy partner scanning
6. **Expiry**: Redemptions expire after 24 hours (configurable)
7. **Max Per User**: Enforced at reservation time
8. **Stock Management**: `availableCoupons` decremented on reservation

---

## 🔒 Security Considerations

1. **Points Deduction**: Atomic transaction to prevent double-spending
2. **QR Token**: JWT with short expiry (5 minutes for active scan)
3. **Partner Validation**: API key required for all partner endpoints
4. **Fraud Prevention**: Track redemption patterns, rate limiting
5. **Coupon Codes**: Unique, non-guessable codes (UUID-based)

---

## 📈 Analytics & Reporting

Track these metrics:
- Total redemptions by reward type
- Most popular rewards
- Average discount given
- Partner performance
- User engagement (redemption rate)
- Carbon impact (sum of carbonContribution)

