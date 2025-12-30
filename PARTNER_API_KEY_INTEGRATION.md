# Partner API Key Integration Guide

Complete documentation on how partner API key authentication works in the Puviyan system.

---

## 🔑 Overview

Partners authenticate using an **API key** sent in the request header. The system validates the key against the `partners` collection in Firestore.

---

## 🏗️ Architecture

### 1. Partner API Key Generation

When a partner is created, an API key is automatically generated:

**Location:** `src/services/admin.service.js` (createPartner function)

```javascript
const tokenService = require('./token.service');

// Generate API key for partner
const partnerId = db.collection('partners').doc().id;
const apiKey = tokenService.generatePartnerApiKey(partnerId);

const partner = {
  partnerId,
  name: "GreenCafe",
  apiKey: apiKey,  // Stored in Firestore
  isActive: true,
  // ... other fields
};
```

**Key Generation Logic:** `src/services/token.service.js`

```javascript
function generatePartnerApiKey(partnerId) {
  const payload = {
    partnerId,
    type: 'partner_api_key',
    createdAt: new Date().toISOString()
  };
  
  // Generate long-lived JWT token
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '365d' // 1 year validity
  });
}
```

**Generated API Key Format:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwYXJ0bmVySWQiOiJwYXJ0bmVyX2dyZWVuY2FmZV8wMDEiLCJ0eXBlIjoicGFydG5lcl9hcGlfa2V5IiwiY3JlYXRlZEF0IjoiMjAyNS0xMi0zMFQyMjowMDowMC4wMDBaIiwiaWF0IjoxNzM1NTk4NDAwLCJleHAiOjE3NjcxMzQ0MDB9.abc123xyz789...
```

---

## 🔐 Authentication Flow

### Step 1: Partner Sends Request

Partner includes API key in header:

```bash
curl -X POST http://localhost:8080/api/v1/redemption/scan \
  -H "x-partner-api-key: eyJhbGciOiJIUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{"qrToken": "..."}'
```

**Header Name:** `x-partner-api-key`

### Step 2: Middleware Validates Key

**Location:** `src/middleware/partner.middleware.js`

```javascript
async function verifyPartnerKey(req, res, next) {
  try {
    // 1. Extract API key from header
    const apiKey = req.headers['x-partner-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing partner API key'
      });
    }

    // 2. Query Firestore for matching partner
    const db = getFirestore();
    const partnersSnapshot = await db.collection('partners')
      .where('apiKey', '==', apiKey)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    // 3. Validate partner exists and is active
    if (partnersSnapshot.empty) {
      return res.status(401).json({
        error: 'INVALID_PARTNER',
        message: 'Invalid or inactive partner API key'
      });
    }

    // 4. Attach partner info to request object
    const partnerDoc = partnersSnapshot.docs[0];
    req.partner = {
      id: partnerDoc.id,
      ...partnerDoc.data()
    };
    
    // 5. Continue to next middleware/controller
    next();
  } catch (error) {
    console.error('Partner verification error:', error);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'Failed to verify partner credentials'
    });
  }
}
```

### Step 3: Controller Uses Partner Info

Controllers can access authenticated partner via `req.partner`:

```javascript
async function scanRedemption(req, res, next) {
  try {
    const { qrToken } = req.body;
    const partnerId = req.partner.id;  // From middleware
    const partnerName = req.partner.name;
    
    const result = await redemptionService.scanRedemption({
      qrToken,
      partnerId
    });
    
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
```

---

## 🛣️ Protected Routes

### Routes Using Partner Authentication

**Redemption Routes:** `src/routes/redemption.routes.js`

```javascript
const { verifyPartnerKey } = require('../middleware/partner.middleware');

// Partner scans QR code
router.post('/scan', verifyPartnerKey, redemptionController.scanRedemption);

// Calculate discount
router.post('/calculate', verifyPartnerKey, redemptionController.calculateDiscount);

// Confirm redemption
router.post('/confirm', verifyPartnerKey, redemptionController.confirmRedemption);

// Rollback redemption
router.post('/rollback', verifyPartnerKey, redemptionController.rollbackRedemption);
```

**Partner Routes:** `src/routes/partner.routes.js`

```javascript
// Get partner's redemption history
router.get('/:partnerId/redemptions', verifyPartnerKey, partnerController.getPartnerRedemptions);

// Get partner analytics
router.get('/:partnerId/analytics', verifyPartnerKey, partnerController.getPartnerAnalytics);
```

**Rewards Management Routes:** `src/routes/rewards-management.routes.js`

```javascript
// Create reward (optional auth - can use Firebase token OR partner key)
router.post('/', apiLimiter, rewardsManagementController.createReward);

// Update reward
router.put('/:rewardId', apiLimiter, rewardsManagementController.updateReward);

// Delete reward
router.delete('/:rewardId', apiLimiter, rewardsManagementController.deleteReward);
```

---

## 📊 Partner Data Structure

### Firestore Collection: `partners/{partnerId}`

```javascript
{
  partnerId: "partner_greencafe_001",
  name: "GreenCafe",
  brandName: "GreenCafe",
  
  // API Authentication
  apiKey: "eyJhbGciOiJIUzI1NiIs...",  // JWT token
  isActive: true,                      // Must be true for auth to work
  
  // Location info
  locations: [
    {
      locationId: "loc_001",
      address: "123 Main St",
      city: "Chennai",
      isActive: true
    }
  ],
  
  // Categories
  categories: ["cafe", "food"],
  
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

## 🔄 Complete Authentication Flow Diagram

```
┌─────────────┐
│   Partner   │
│    Store    │
└──────┬──────┘
       │
       │ 1. Send request with API key
       │    Header: x-partner-api-key: eyJhbG...
       ▼
┌─────────────────────────────────────┐
│   Partner Middleware                │
│   (verifyPartnerKey)                │
│                                     │
│   1. Extract API key from header    │
│   2. Query Firestore:               │
│      partners.where('apiKey', '==') │
│   3. Check isActive == true         │
│   4. Attach partner to req.partner  │
└──────┬──────────────────────────────┘
       │
       │ 2. Partner authenticated
       │    req.partner = { id, name, ... }
       ▼
┌─────────────────────────────────────┐
│   Controller                        │
│   (scanRedemption, confirm, etc.)   │
│                                     │
│   - Access: req.partner.id          │
│   - Access: req.partner.name        │
│   - Process business logic          │
└──────┬──────────────────────────────┘
       │
       │ 3. Return response
       ▼
┌─────────────┐
│   Partner   │
│    Store    │
└─────────────┘
```

---

## 🧪 Testing Partner Authentication

### Test 1: Create Partner and Get API Key

```bash
# Create partner (admin endpoint)
curl -X POST http://localhost:8080/api/v1/admin/partners \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "TestCafe",
    "brandName": "TestCafe",
    "categories": ["cafe"]
  }'

# Response includes API key
{
  "partnerId": "partner_testcafe_001",
  "apiKey": "eyJhbGciOiJIUzI1NiIs...",
  "message": "Partner created successfully"
}
```

### Test 2: Use API Key to Scan QR

```bash
# Use the API key from step 1
curl -X POST http://localhost:8080/api/v1/redemption/scan \
  -H "x-partner-api-key: eyJhbGciOiJIUzI1NiIs..." \
  -H "Content-Type: application/json" \
  -d '{
    "qrToken": "USER_QR_TOKEN"
  }'

# Success response
{
  "redemptionId": "rdm_123",
  "rewardType": "coupon",
  "status": "active"
}
```

### Test 3: Invalid API Key

```bash
curl -X POST http://localhost:8080/api/v1/redemption/scan \
  -H "x-partner-api-key: invalid_key" \
  -H "Content-Type: application/json" \
  -d '{"qrToken": "..."}'

# Error response
{
  "error": "INVALID_PARTNER",
  "message": "Invalid or inactive partner API key"
}
```

### Test 4: Missing API Key

```bash
curl -X POST http://localhost:8080/api/v1/redemption/scan \
  -H "Content-Type: application/json" \
  -d '{"qrToken": "..."}'

# Error response
{
  "error": "UNAUTHORIZED",
  "message": "Missing partner API key"
}
```

---

## 🔒 Security Features

### 1. **JWT-Based Keys**
- API keys are JWT tokens with 1-year expiry
- Contains partnerId and creation timestamp
- Signed with server secret (not reversible)

### 2. **Firestore Validation**
- Every request queries Firestore to validate key
- Checks `isActive` status (can disable partners)
- Ensures partner exists and is authorized

### 3. **Rate Limiting**
- Partner endpoints have rate limiting
- Scan endpoint: 30 requests/minute
- Other endpoints: 100 requests/15 minutes

### 4. **Scope Limitation**
- Partners can only access their own data
- Controllers verify `req.partner.id` matches resource owner
- Example: Partner A cannot view Partner B's redemptions

### 5. **HTTPS Only**
- Production must use HTTPS
- API keys transmitted securely
- No plain-text storage

---

## 🛠️ Partner Key Management

### Generate New Key

```javascript
// In admin.service.js
const newApiKey = tokenService.generatePartnerApiKey(partnerId);

await db.collection('partners').doc(partnerId).update({
  apiKey: newApiKey,
  apiKeyUpdatedAt: new Date()
});
```

### Revoke Key (Deactivate Partner)

```javascript
await db.collection('partners').doc(partnerId).update({
  isActive: false,
  deactivatedAt: new Date(),
  deactivatedReason: "Security breach"
});
```

### Rotate Key

```javascript
// Generate new key
const newApiKey = tokenService.generatePartnerApiKey(partnerId);

// Update in Firestore
await db.collection('partners').doc(partnerId).update({
  apiKey: newApiKey,
  previousApiKey: currentApiKey,  // Keep old key for grace period
  apiKeyRotatedAt: new Date()
});
```

---

## 📋 Best Practices

### For Partners

1. **Secure Storage**
   - Store API key in environment variables
   - Never commit to version control
   - Never expose in client-side code

2. **Key Rotation**
   - Rotate keys periodically (every 6-12 months)
   - Immediately rotate if compromised

3. **Error Handling**
   - Handle 401 errors (invalid/expired key)
   - Implement retry logic with exponential backoff

4. **Monitoring**
   - Monitor API usage
   - Alert on unusual patterns
   - Track failed authentication attempts

### For System Admins

1. **Key Generation**
   - Use cryptographically secure random generation
   - Include partner metadata in JWT payload
   - Set appropriate expiry (1 year default)

2. **Validation**
   - Always check `isActive` status
   - Log authentication attempts
   - Implement rate limiting

3. **Revocation**
   - Provide instant revocation mechanism
   - Maintain audit log of key changes
   - Support grace period for key rotation

---

## 🔍 Troubleshooting

### Issue: "Missing partner API key"

**Cause:** Header not sent or wrong header name

**Solution:**
```bash
# Correct header name
-H "x-partner-api-key: YOUR_KEY"

# NOT these:
-H "Authorization: Bearer YOUR_KEY"  ❌
-H "api-key: YOUR_KEY"  ❌
-H "partner-key: YOUR_KEY"  ❌
```

### Issue: "Invalid or inactive partner API key"

**Causes:**
1. Wrong API key
2. Partner deactivated (`isActive: false`)
3. Key expired
4. Partner deleted

**Solution:**
1. Verify API key is correct
2. Check partner status in Firestore
3. Contact admin to reactivate
4. Generate new key if expired

### Issue: "Failed to verify partner credentials"

**Cause:** Server error (Firestore connection issue)

**Solution:**
- Check server logs
- Verify Firestore connection
- Retry request

---

## 📊 Monitoring & Analytics

### Track Partner API Usage

```javascript
// Log every partner request
async function verifyPartnerKey(req, res, next) {
  // ... validation logic ...
  
  // Log usage
  await db.collection('partnerApiLogs').add({
    partnerId: req.partner.id,
    endpoint: req.path,
    method: req.method,
    timestamp: new Date(),
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  
  next();
}
```

### Analytics Queries

```javascript
// Get partner API usage
const logs = await db.collection('partnerApiLogs')
  .where('partnerId', '==', 'partner_123')
  .where('timestamp', '>=', last30Days)
  .get();

// Failed authentication attempts
const failures = await db.collection('authFailures')
  .where('type', '==', 'partner_api_key')
  .where('timestamp', '>=', lastHour)
  .get();
```

---

## ✅ Summary

**How Partner API Key Works:**

1. **Generation:** JWT token created when partner is registered
2. **Storage:** Stored in `partners` collection in Firestore
3. **Transmission:** Sent in `x-partner-api-key` header
4. **Validation:** Middleware queries Firestore to verify key
5. **Authorization:** Partner info attached to `req.partner`
6. **Usage:** Controllers access partner data for business logic

**Key Files:**
- `src/middleware/partner.middleware.js` - Authentication logic
- `src/services/token.service.js` - Key generation
- `src/services/admin.service.js` - Partner creation
- `src/routes/*.routes.js` - Protected endpoints

**Security:** JWT-based, Firestore-validated, rate-limited, HTTPS-only
