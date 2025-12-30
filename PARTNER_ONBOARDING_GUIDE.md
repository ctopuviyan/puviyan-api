# Partner Onboarding Guide - Puviyan Rewards System

Complete guide for partners to onboard and create rewards on the Puviyan platform.

---

## 📋 Overview

This guide explains how partners can:
1. Register on the platform
2. Get API credentials
3. Create and manage rewards
4. Handle redemptions at their stores

---

## 🎯 Partner Onboarding Contract

### Step 1: Partner Registration

Partners must be registered in the system with the following information:

#### Required Partner Information

```json
{
  "name": "GreenCafe",
  "brandName": "GreenCafe",
  "logo": "https://example.com/logo.png",
  
  "locations": [
    {
      "locationId": "loc_001",
      "address": "123 Main Street, Chennai",
      "city": "Chennai",
      "state": "Tamil Nadu",
      "pincode": "600001",
      "coordinates": {
        "lat": 13.0827,
        "lng": 80.2707
      },
      "isActive": true
    }
  ],
  
  "categories": ["cafe", "food", "sustainable"],
  
  "contactInfo": {
    "email": "partner@greencafe.com",
    "phone": "+91-9876543210",
    "website": "https://greencafe.com"
  },
  
  "businessInfo": {
    "gst": "29ABCDE1234F1Z5",
    "pan": "ABCDE1234F",
    "businessType": "Private Limited"
  },
  
  "isActive": true
}
```

#### Partner Registration API

**Endpoint:** `POST /api/v1/admin/partners`

**Request:**
```bash
curl -X POST http://localhost:8080/api/v1/admin/partners \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "GreenCafe",
    "brandName": "GreenCafe",
    "logo": "https://example.com/logo.png",
    "locations": [...],
    "categories": ["cafe", "food"],
    "contactInfo": {...},
    "businessInfo": {...}
  }'
```

**Response:**
```json
{
  "partnerId": "partner_greencafe_001",
  "apiKey": "pk_live_abc123xyz789...",
  "message": "Partner created successfully"
}
```

**Important:** Save the `apiKey` - this is required for all partner operations.

---

## 🔑 API Authentication

Partners authenticate using their API key in the request header:

```bash
-H "x-partner-api-key: pk_live_abc123xyz789..."
```

---

## 🎁 Creating Rewards

Partners can create **3 types of rewards**:

### 1. Coupon Type (Free Items)

**Use Case:** Free coffee, free dessert, free item

**Required Fields:**
```json
{
  "rewardTitle": "Free Organic Coffee",
  "rewardSubtitle": "Enjoy a complimentary organic coffee on us",
  "rewardType": "coupon",
  
  // Required for coupon type
  "totalCoupons": 100,
  
  // Common required fields
  "brandName": "GreenCafe",
  "deductPoints": 150,
  "maxPerUser": 2,
  "validFrom": "2025-12-30T00:00:00Z",
  "validTo": "2026-03-31T23:59:59Z",
  "status": "active"
}
```

**Optional Fields:**
```json
{
  "rewardDetails": [
    "One free organic coffee of any size",
    "Valid at all GreenCafe locations",
    "Made with 100% organic beans"
  ],
  "howToClaim": [
    "Reserve this reward to get your coupon code",
    "Visit any GreenCafe location",
    "Show your coupon code to the barista"
  ],
  "termsAndConditions": "Valid only at participating locations. Cannot be combined with other offers.",
  "previewImage": "https://example.com/preview.jpg",
  "fullImage": "https://example.com/full.jpg",
  "carbonContribution": 0.5,
  "categories": ["cafe", "food", "sustainable"],
  "partnerId": "partner_greencafe_001"
}
```

### 2. Percent Off Type (Percentage Discount)

**Use Case:** 20% off, 15% off entire bill

**Required Fields:**
```json
{
  "rewardTitle": "20% Off Your Purchase",
  "rewardType": "percent_off",
  
  // Required for percent_off type
  "discountPercent": 20,
  "maxDiscountAmount": 500,
  "minPurchaseAmount": 1000,
  
  // Common required fields
  "brandName": "GreenCafe",
  "deductPoints": 200,
  "maxPerUser": 1,
  "validFrom": "2025-12-30T00:00:00Z",
  "validTo": "2026-02-28T23:59:59Z",
  "status": "active"
}
```

**Business Logic:**
- User gets `discountPercent`% off their bill
- Discount is capped at `maxDiscountAmount`
- Only valid if bill >= `minPurchaseAmount`

**Example:**
- Bill: ₹1500
- Discount: 20% = ₹300
- Max cap: ₹500
- Applied: ₹300 (within cap)
- Final: ₹1200

### 3. Amount Off Type (Fixed Discount)

**Use Case:** ₹50 off, ₹100 off

**Required Fields:**
```json
{
  "rewardTitle": "₹50 Off Your Order",
  "rewardType": "amount_off",
  
  // Required for amount_off type
  "discountAmount": 50,
  "minPurchaseAmount": 500,
  
  // Common required fields
  "brandName": "GreenCafe",
  "deductPoints": 100,
  "maxPerUser": 3,
  "validFrom": "2025-12-30T00:00:00Z",
  "validTo": "2026-01-31T23:59:59Z",
  "status": "active"
}
```

**Business Logic:**
- User gets flat `discountAmount` off
- Only valid if bill >= `minPurchaseAmount`

---

## 📝 Complete Reward Creation Contract

### API Endpoint

**POST** `/api/v1/rewards-management`

### Request Headers
```
Content-Type: application/json
x-partner-api-key: YOUR_PARTNER_API_KEY
```

### Request Body Schema

```typescript
{
  // === REQUIRED FIELDS (All Types) ===
  rewardTitle: string,              // e.g., "Free Coffee"
  rewardType: "coupon" | "percent_off" | "amount_off",
  brandName: string,                // Must match partner's brandName
  deductPoints: number,             // Points to deduct from user
  maxPerUser: number,               // Max redemptions per user
  validFrom: string (ISO 8601),     // Start date
  validTo: string (ISO 8601),       // End date
  status: "active" | "inactive",
  
  // === TYPE-SPECIFIC REQUIRED FIELDS ===
  
  // For "coupon" type:
  totalCoupons?: number,            // Total available coupons
  
  // For "percent_off" type:
  discountPercent?: number,         // 1-100
  maxDiscountAmount?: number,       // Max discount cap in currency
  minPurchaseAmount?: number,       // Min bill amount required
  
  // For "amount_off" type:
  discountAmount?: number,          // Fixed discount amount
  minPurchaseAmount?: number,       // Min bill amount required
  
  // === OPTIONAL FIELDS ===
  rewardSubtitle?: string,
  rewardDetails?: string[],         // Array of benefit descriptions
  howToClaim?: string[],            // Step-by-step instructions
  termsAndConditions?: string,
  previewImage?: string (URL),      // Thumbnail image
  fullImage?: string (URL),         // Full-size image
  carbonContribution?: number,      // Environmental impact score
  categories?: string[],            // e.g., ["cafe", "food"]
  partnerId?: string,               // Your partner ID
  usefulnessScore?: number          // Initial score (default: 0)
}
```

### Validation Rules

**Common Validations:**
- `rewardTitle`: Required, non-empty string
- `rewardType`: Must be one of: "coupon", "percent_off", "amount_off"
- `brandName`: Required, must match partner's registered brand
- `deductPoints`: Required, must be > 0
- `maxPerUser`: Required, must be >= 1
- `validFrom`: Required, must be valid ISO 8601 date
- `validTo`: Required, must be after `validFrom`
- `status`: Must be "active" or "inactive"

**Coupon Type Validations:**
- `totalCoupons`: Required, must be > 0

**Percent Off Type Validations:**
- `discountPercent`: Required, must be 1-100
- `maxDiscountAmount`: Optional, if provided must be > 0
- `minPurchaseAmount`: Optional, if provided must be > 0

**Amount Off Type Validations:**
- `discountAmount`: Required, must be > 0
- `minPurchaseAmount`: Optional, if provided must be > 0

### Response Schema

**Success (201 Created):**
```json
{
  "rewardId": "reward_abc123",
  "rewardTitle": "Free Organic Coffee",
  "rewardType": "coupon",
  "availableCoupons": 100,
  "totalCoupons": 100,
  "deductPoints": 150,
  "status": "active",
  "message": "Reward created successfully",
  "createdAt": "2025-12-30T22:29:53.489Z"
}
```

**Error (400 Bad Request):**
```json
{
  "error": "VALIDATION_ERROR",
  "message": "Missing required field: rewardTitle"
}
```

---

## 📊 Managing Rewards

### Update Reward

**PUT** `/api/v1/rewards-management/:rewardId`

```bash
curl -X PUT http://localhost:8080/api/v1/rewards-management/reward_abc123 \
  -H "x-partner-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "rewardTitle": "Updated Title",
    "status": "inactive"
  }'
```

**Note:** Cannot update `createdAt`, `createdBy`, `likeCount`, `dislikeCount`, `availableCoupons`

### Update Stock (Coupon Type Only)

**PATCH** `/api/v1/rewards-management/:rewardId/stock`

```bash
curl -X PATCH http://localhost:8080/api/v1/rewards-management/reward_abc123/stock \
  -H "x-partner-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "totalCoupons": 150
  }'
```

### Delete Reward (Soft Delete)

**DELETE** `/api/v1/rewards-management/:rewardId`

```bash
curl -X DELETE http://localhost:8080/api/v1/rewards-management/reward_abc123 \
  -H "x-partner-api-key: YOUR_KEY"
```

Sets `status: "inactive"` and adds `deletedAt` timestamp.

### View Analytics

**GET** `/api/v1/rewards-management/:rewardId/analytics`

```bash
curl http://localhost:8080/api/v1/rewards-management/reward_abc123/analytics \
  -H "x-partner-api-key: YOUR_KEY"
```

**Response:**
```json
{
  "rewardId": "reward_abc123",
  "rewardTitle": "Free Organic Coffee",
  "stock": {
    "total": 100,
    "available": 85,
    "redeemed": 15
  },
  "redemptions": {
    "total": 15,
    "redeemed": 15,
    "cancelled": 0
  },
  "points": {
    "totalDeducted": 2250,
    "averagePerRedemption": 150
  }
}
```

---

## 🏪 Handling Redemptions at Store

### 1. Customer Shows QR Code

Customer reserves reward in app and shows QR code at your store.

### 2. Scan QR Code

**POST** `/api/v1/redemption/scan`

```bash
curl -X POST http://localhost:8080/api/v1/redemption/scan \
  -H "x-partner-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "qrToken": "eyJhbGciOiJIUzI1NiIs..."
  }'
```

**Response (Coupon):**
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
  "instructions": ["Provide one free coffee"]
}
```

**Response (Percent Off):**
```json
{
  "redemptionId": "rdm_abc456",
  "rewardType": "percent_off",
  "discountPercent": 20,
  "maxDiscountAmount": 500,
  "minPurchaseAmount": 1000,
  "user": {...}
}
```

### 3. Calculate Discount (For percent_off/amount_off only)

**POST** `/api/v1/redemption/calculate`

```bash
curl -X POST http://localhost:8080/api/v1/redemption/calculate \
  -H "x-partner-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "redemptionId": "rdm_abc456",
    "userId": "user_123",
    "billAmount": 1500
  }'
```

**Response:**
```json
{
  "billAmount": 1500,
  "appliedDiscount": 300,
  "finalAmount": 1200,
  "message": "20% discount applied (₹300 off)"
}
```

### 4. Confirm Redemption

**POST** `/api/v1/redemption/confirm`

```bash
curl -X POST http://localhost:8080/api/v1/redemption/confirm \
  -H "x-partner-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "redemptionId": "rdm_abc456",
    "userId": "user_123",
    "partnerTransactionId": "pos_order_001",
    "billAmount": 1500,
    "appliedDiscount": 300
  }'
```

**Response:**
```json
{
  "success": true,
  "redemptionId": "rdm_abc456",
  "status": "redeemed",
  "message": "Redemption confirmed successfully"
}
```

---

## 📋 Best Practices

### Reward Creation
1. **Clear Titles**: Use descriptive titles (e.g., "Free Coffee" not "Reward 1")
2. **Realistic Stock**: Set `totalCoupons` based on actual capacity
3. **Appropriate Points**: Balance points with reward value
4. **Valid Dates**: Set realistic validity periods
5. **Complete Details**: Fill `rewardDetails` and `howToClaim` arrays
6. **Terms & Conditions**: Always specify limitations

### Redemption Handling
1. **Verify QR**: Always scan QR code, don't accept manual codes
2. **Check Minimum**: Verify bill meets `minPurchaseAmount`
3. **Apply Correct Discount**: Use `/calculate` endpoint for accuracy
4. **Confirm Immediately**: Call `/confirm` right after service
5. **Handle Errors**: Be prepared to rollback if needed

### Stock Management
1. **Monitor Stock**: Check analytics regularly
2. **Replenish**: Update stock when adding more coupons
3. **Deactivate**: Set `status: "inactive"` when out of stock

---

## 🔒 Security

1. **Protect API Key**: Never expose in client-side code
2. **HTTPS Only**: Always use HTTPS in production
3. **Validate QR**: Don't trust QR tokens without verification
4. **Rate Limiting**: System has built-in rate limits
5. **Fraud Prevention**: System tracks redemption patterns

---

## 📞 Support

For partner support:
- Email: partners@puviyan.com
- API Documentation: See `API_REFERENCE.md`
- Testing Guide: See `E2E_TESTING_GUIDE.md`

---

## ✅ Onboarding Checklist

- [ ] Partner registered in system
- [ ] API key received and secured
- [ ] Test reward created successfully
- [ ] Test redemption flow completed
- [ ] Staff trained on scanning process
- [ ] POS system integrated (if applicable)
- [ ] Go live!
