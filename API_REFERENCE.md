# Puviyan API Reference

Complete API documentation for testing all redemption endpoints.

## Base URL
```
http://localhost:8080/api/v1
```

---

## 🎯 Complete Redemption Flow

### Overview
The redemption system uses a **two-phase commit** pattern:
1. **Initiate** → User generates QR code
2. **Scan** → Partner scans and reserves points
3. **Confirm** → Partner confirms after payment (points deducted)
4. **Rollback** → Cancel if needed (points refunded)

---

## 📋 All Redemption Endpoints

### 1. Initiate Redemption
**User generates QR code for redemption**

```bash
POST /redemption/initiate
```

**Headers:**
```
Authorization: Bearer <FIREBASE_ID_TOKEN>
Content-Type: application/json
```

**Request Body:**
```json
{
  "points": 500,
  "partnerId": "test_cafe_001"
}
```

**Response:**
```json
{
  "redemptionId": "rdm_abc123",
  "qrToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "discount": 50,
  "points": 500,
  "expiresAt": "2025-12-30T22:00:00.000Z",
  "partner": {
    "id": "test_cafe_001",
    "name": "Test Cafe",
    "logo": "https://via.placeholder.com/150"
  }
}
```

---

### 2. Scan Redemption
**Partner scans QR code and reserves points**

```bash
POST /redemption/scan
```

**Headers:**
```
x-partner-api-key: test_partner_key_12345
Content-Type: application/json
```

**Request Body:**
```json
{
  "qrToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**
```json
{
  "redemptionId": "rdm_abc123",
  "discount": 50,
  "points": 500,
  "status": "reserved",
  "message": "Redemption reserved. Please confirm after payment."
}
```

---

### 3. Confirm Redemption
**Partner confirms redemption after successful payment**

```bash
POST /redemption/confirm
```

**Headers:**
```
x-partner-api-key: test_partner_key_12345
Content-Type: application/json
```

**Request Body:**
```json
{
  "redemptionId": "rdm_abc123",
  "partnerTransactionId": "pos_order_456",
  "appliedDiscount": 50
}
```

**Response:**
```json
{
  "redemptionId": "rdm_abc123",
  "status": "confirmed",
  "message": "Redemption confirmed successfully",
  "pointsDeducted": 500,
  "discountApplied": 50
}
```

---

### 4. Rollback Redemption
**Cancel redemption and refund points**

```bash
POST /redemption/rollback
```

**Headers:**
```
x-partner-api-key: test_partner_key_12345
Content-Type: application/json
```

**Request Body:**
```json
{
  "redemptionId": "rdm_abc123",
  "reason": "Customer cancelled order"
}
```

**Response:**
```json
{
  "redemptionId": "rdm_abc123",
  "status": "cancelled",
  "message": "Redemption cancelled successfully",
  "pointsRefunded": 500
}
```

---

### 5. Get Redemption History
**Get user's past redemptions**

```bash
GET /redemption/history?limit=20&offset=0
```

**Headers:**
```
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

**Response:**
```json
{
  "redemptions": [
    {
      "id": "rdm_abc123",
      "partnerId": "test_cafe_001",
      "partnerName": "Test Cafe",
      "points": 500,
      "discount": 50,
      "status": "confirmed",
      "createdAt": "2025-12-30T21:30:00.000Z",
      "confirmedAt": "2025-12-30T21:35:00.000Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

---

### 6. Get Redemption Details
**Get single redemption by ID**

```bash
GET /redemption/:redemptionId
```

**Headers:**
```
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

**Response:**
```json
{
  "id": "rdm_abc123",
  "userId": "user_xyz",
  "partnerId": "test_cafe_001",
  "partnerName": "Test Cafe",
  "points": 500,
  "discount": 50,
  "status": "confirmed",
  "method": "qr",
  "createdAt": "2025-12-30T21:30:00.000Z",
  "confirmedAt": "2025-12-30T21:35:00.000Z"
}
```

---

## 💰 Points APIs

### Get Points Balance
```bash
GET /points/balance
Headers: Authorization: Bearer <FIREBASE_ID_TOKEN>
```

### Calculate Discount
```bash
POST /points/calculate
Headers: Authorization: Bearer <FIREBASE_ID_TOKEN>
Body: {
  "points": 500,
  "partnerId": "test_cafe_001"
}
```

### Get Available Offers
```bash
GET /points/offers?partnerId=test_cafe_001
```

---

## 🏪 Partner APIs

### Get All Partners
```bash
GET /partners
```

### Get Partner Details
```bash
GET /partners/:partnerId
```

### Get Partner Redemptions
```bash
GET /partners/:partnerId/redemptions
Headers: x-partner-api-key: <PARTNER_API_KEY>
```

### Get Partner Analytics
```bash
GET /partners/:partnerId/analytics?period=30d
Headers: x-partner-api-key: <PARTNER_API_KEY>
```

---

## 🔐 Admin APIs

### Create Partner
```bash
POST /admin/partners
Headers: Authorization: Bearer <FIREBASE_ID_TOKEN>
Body: {
  "name": "New Cafe",
  "category": "cafe",
  "location": {
    "address": "123 Street",
    "city": "Chennai"
  }
}
```

### Update Partner
```bash
PUT /admin/partners/:partnerId
Headers: Authorization: Bearer <FIREBASE_ID_TOKEN>
```

### Delete Partner
```bash
DELETE /admin/partners/:partnerId
Headers: Authorization: Bearer <FIREBASE_ID_TOKEN>
```

### Get System Analytics
```bash
GET /admin/analytics?period=30d
Headers: Authorization: Bearer <FIREBASE_ID_TOKEN>
```

---

## 🧪 Testing with Test Data

We've created test data:
- **Partner ID**: `test_cafe_001`
- **Partner API Key**: `test_partner_key_12345`

### Test Commands

**1. Get all partners:**
```bash
curl http://localhost:8080/api/v1/partners
```

**2. Get partner details:**
```bash
curl http://localhost:8080/api/v1/partners/test_cafe_001
```

**3. Test with Firebase token (requires real user):**
```bash
# Get your Firebase ID token from Flutter app
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:8080/api/v1/points/balance
```

---

## 📝 Notes

- **All redemption endpoints are implemented** in `/src/routes/redemption.routes.js`
- **Service logic** is in `/src/services/redemption.service.js`
- **Two-phase commit** ensures points are only deducted after payment confirmation
- **JWT tokens** in QR codes expire in 5 minutes (configurable)
- **Rate limiting** prevents abuse (20 redemptions per 15 minutes)
