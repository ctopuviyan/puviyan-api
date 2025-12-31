# Reward Schema Documentation

## Complete Field Mapping

This document maps your existing reward system fields to the current API implementation.

---

## ✅ **Supported Fields**

All fields from your existing system are now supported in the API.

### **Basic Information**
| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `rewardTitle` | string | ✅ Yes | Main title of the reward | "EcoMart Discount" |
| `rewardSubtitle` | string | No | Subtitle/tagline | "Save on green shopping" |
| `rewardType` | string | ✅ Yes | Type: `coupon`, `percent_off`, `amount_off` | "percent_off" |
| `rewardDetails` | array | No | Array of detail strings | ["10% discount", "Valid on $50+"] |
| `brandName` | string | ✅ Yes | Brand/partner name | "EcoMart" |
| `status` | string | No | Status: `active`, `inactive`, `expired` | "active" |

### **Points & Limits**
| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `deductPoints` | number | ✅ Yes | Points required to redeem | 100 |
| `maxPerUser` | number | No | Max redemptions per user (default: 1) | 1 |

### **Coupon-Specific** (when `rewardType` = "coupon")
| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `totalCoupons` | number | ✅ Yes | Total available coupons | 100 |
| `availableCoupons` | string/number | Auto | Remaining coupons (auto-calculated) | "50" |

### **Discount-Specific** (when `rewardType` = "percent_off")
| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `discountPercent` | number | ✅ Yes | Discount percentage (1-100) | 10 |
| `maxDiscountAmount` | number | No | Maximum discount cap | 50 |
| `minPurchaseAmount` | number | No | Minimum purchase required | 50 |

### **Discount-Specific** (when `rewardType` = "amount_off")
| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `discountAmount` | number | ✅ Yes | Fixed discount amount | 20 |
| `minPurchaseAmount` | number | No | Minimum purchase required | 50 |

### **Validity**
| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `validFrom` | string/Date | ✅ Yes | Start date (ISO 8601 or Date) | "2024-01-01" |
| `validTo` | string/Date | ✅ Yes | End date (ISO 8601 or Date) | "2024-12-31" |

### **Instructions**
| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `howToClaim` | array | No | Array of instruction strings | ["Show app at checkout", "Scan QR code"] |
| `termsAndConditions` | string | No | Terms text | "Valid on eco-friendly products only" |

### **Images**
| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `previewImage` | string | No | Thumbnail image URL | "https://example.com/thumb.jpg" |
| `previewImageGreyed` | string | No | Greyed-out thumbnail (disabled state) | "https://example.com/thumb-grey.jpg" |
| `fullImage` | string | No | Full-size image URL | "https://example.com/full.jpg" |
| `fullImageGreyed` | string | No | Greyed-out full image | "https://example.com/full-grey.jpg" |

### **Engagement**
| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `likeCount` | number | No | Number of likes (default: 0) | 15 |
| `dislikeCount` | number | No | Number of dislikes (default: 0) | 2 |
| `usefulnessScore` | number | No | User rating score (default: 0) | 4.5 |

### **Impact**
| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `carbonContribution` | number | No | Carbon offset value (default: 0) | 5.2 |

### **Organization**
| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `orgId` | string | No | Organization ID (null = public) | "org_123" |
| `categories` | array | No | Category tags | ["eco-friendly", "shopping"] |

### **Partner**
| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `partnerId` | string | No | Associated partner ID | "partner_abc" |

### **Timestamps** (Auto-generated)
| Field | Type | Auto | Description |
|-------|------|------|-------------|
| `createdAt` | string | ✅ | ISO 8601 timestamp |
| `updatedAt` | string | ✅ | ISO 8601 timestamp |
| `createdBy` | string | ✅ | User/admin ID who created |

---

## 📝 **API Endpoint**

### **Create Reward**

```http
POST /api/v1/rewards
Content-Type: application/json
Authorization: Bearer <admin-token>
```

### **Request Body Example (Coupon Type)**

```json
{
  "rewardTitle": "Free Coffee",
  "rewardSubtitle": "Enjoy a complimentary coffee",
  "rewardType": "coupon",
  "rewardDetails": [
    "Valid for any size coffee",
    "One per customer per day"
  ],
  "brandName": "GreenCafe",
  "deductPoints": 100,
  "totalCoupons": 50,
  "maxPerUser": 1,
  "validFrom": "2024-01-01",
  "validTo": "2024-12-31",
  "howToClaim": [
    "Show app at checkout",
    "Scan QR code"
  ],
  "previewImage": "https://example.com/coffee-thumb.jpg",
  "previewImageGreyed": "https://example.com/coffee-thumb-grey.jpg",
  "fullImage": "https://example.com/coffee-full.jpg",
  "fullImageGreyed": "https://example.com/coffee-full-grey.jpg",
  "carbonContribution": 2.5,
  "categories": ["food", "beverage"],
  "status": "active"
}
```

### **Request Body Example (Percent Off Type)**

```json
{
  "rewardTitle": "EcoMart Discount",
  "rewardSubtitle": "Save on green shopping",
  "rewardType": "percent_off",
  "rewardDetails": [
    "10% discount on eco-friendly products",
    "Valid on minimum purchase of $50"
  ],
  "brandName": "EcoMart",
  "deductPoints": 100,
  "discountPercent": 10,
  "minPurchaseAmount": 50,
  "maxPerUser": 1,
  "validFrom": "2024-01-01",
  "validTo": "2024-12-31",
  "howToClaim": [
    "Show app at checkout",
    "Scan QR code"
  ],
  "previewImage": "https://example.com/ec1-thumb.jpg",
  "previewImageGreyed": "https://example.com/ec1-thumb-grey.jpg",
  "fullImage": "https://example.com/ec1.jpg",
  "fullImageGreyed": "https://example.com/ec1-grey.jpg",
  "likeCount": 15,
  "dislikeCount": 2,
  "usefulnessScore": 4.5,
  "carbonContribution": 5.0,
  "categories": ["shopping", "eco-friendly"],
  "status": "active"
}
```

### **Request Body Example (Amount Off Type)**

```json
{
  "rewardTitle": "$20 Off Purchase",
  "rewardSubtitle": "Save on your next order",
  "rewardType": "amount_off",
  "rewardDetails": [
    "$20 off your purchase",
    "Minimum order $100"
  ],
  "brandName": "GreenStore",
  "deductPoints": 200,
  "discountAmount": 20,
  "minPurchaseAmount": 100,
  "maxPerUser": 2,
  "validFrom": "2024-01-01",
  "validTo": "2024-12-31",
  "howToClaim": [
    "Apply code at checkout",
    "Show QR code in store"
  ],
  "previewImage": "https://example.com/discount-thumb.jpg",
  "fullImage": "https://example.com/discount-full.jpg",
  "carbonContribution": 3.0,
  "categories": ["shopping"],
  "status": "active"
}
```

---

## 🔄 **Field Mapping from Your Existing System**

| Your Field | API Field | Notes |
|------------|-----------|-------|
| `rewardTitle` | `rewardTitle` | ✅ Same |
| `rewardSubtitle` | `rewardSubtitle` | ✅ Same |
| `rewardType: "discount"` | `rewardType: "percent_off"` or `"amount_off"` | ⚠️ Map "discount" to specific type |
| `rewardDetails` | `rewardDetails` | ✅ Same (array) |
| `brandName` | `brandName` | ✅ Same |
| `deductPoints` | `deductPoints` | ✅ Same |
| `availableCoupons` | `availableCoupons` | ✅ Same (auto-calculated) |
| `maxPerUser` | `maxPerUser` | ✅ Same |
| `validFrom` | `validFrom` | ✅ Same |
| `validTo` | `validTo` | ✅ Same |
| `status` | `status` | ✅ Same ("available" → "active") |
| `howToClaim` | `howToClaim` | ✅ Same (array) |
| `previewImage` | `previewImage` | ✅ Same |
| `previewImageGreyed` | `previewImageGreyed` | ✅ Now supported |
| `fullImage` | `fullImage` | ✅ Same |
| `fullImageGreyed` | `fullImageGreyed` | ✅ Now supported |
| `likeCount` | `likeCount` | ✅ Same |
| `dislikeCount` | `dislikeCount` | ✅ Same |
| `usefulnessScore` | `usefulnessScore` | ✅ Same |
| `createdAt` | `createdAt` | ✅ Same |
| `updatedAt` | `updatedAt` | ✅ Same |

---

## 🎯 **Migration Notes**

### **1. Reward Type Mapping**

If your existing system uses `"discount"` as a rewardType, you need to map it to either:
- `"percent_off"` - for percentage-based discounts (e.g., 10% off)
- `"amount_off"` - for fixed amount discounts (e.g., $20 off)

### **2. Status Mapping**

- `"available"` → `"active"`
- `"unavailable"` → `"inactive"`

### **3. Date Format**

The API accepts both:
- ISO 8601 strings: `"2024-01-01"` or `"2024-01-01T00:00:00.000Z"`
- JavaScript Date objects

Dates are stored as Firestore Timestamps and returned as ISO 8601 strings in responses.

### **4. Available Coupons**

- Your system stores this as a string: `"50"`
- Our API stores as number: `50`
- Auto-calculated when coupons are redeemed

---

## 🧪 **Testing**

### **Test with cURL**

```bash
curl -X POST https://puviyan-api-staging-omzkebgc5q-uc.a.run.app/api/v1/rewards \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-admin-token>" \
  -d '{
    "rewardTitle": "EcoMart Discount",
    "rewardSubtitle": "Save on green shopping",
    "rewardType": "percent_off",
    "rewardDetails": ["10% discount on eco-friendly products", "Valid on minimum purchase of $50"],
    "brandName": "EcoMart",
    "deductPoints": 100,
    "discountPercent": 10,
    "minPurchaseAmount": 50,
    "maxPerUser": 1,
    "validFrom": "2024-01-01",
    "validTo": "2024-12-31",
    "howToClaim": ["Show app at checkout", "Scan QR code"],
    "previewImage": "https://example.com/ec1-thumb.jpg",
    "previewImageGreyed": "https://example.com/ec1-thumb-grey.jpg",
    "fullImage": "https://example.com/ec1.jpg",
    "fullImageGreyed": "https://example.com/ec1-grey.jpg",
    "likeCount": 15,
    "dislikeCount": 2,
    "usefulnessScore": 4.5,
    "carbonContribution": 5.0,
    "categories": ["shopping", "eco-friendly"],
    "status": "active"
  }'
```

### **Test with Testing UI**

Open: `https://puviyan-api-staging-omzkebgc5q-uc.a.run.app/`

Navigate to "Create Reward" tab and fill in all fields.

---

## ✅ **Summary**

**All fields from your existing reward system are now supported!**

### **New Fields Added:**
- ✅ `previewImageGreyed`
- ✅ `fullImageGreyed`
- ✅ `likeCount` (can be set on creation)
- ✅ `dislikeCount` (can be set on creation)

### **Existing Fields:**
- ✅ All other fields were already supported
- ✅ Arrays (`rewardDetails`, `howToClaim`) fully supported
- ✅ Optional fields handled correctly

### **API Compatibility:**
- ✅ 100% compatible with your existing reward structure
- ✅ Can import existing rewards with minimal changes
- ✅ Only need to map `rewardType: "discount"` to specific type

**Your mobile/web app can now create rewards with the exact same structure as your existing system!** 🎉
