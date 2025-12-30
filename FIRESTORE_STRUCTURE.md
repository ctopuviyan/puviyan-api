# Firestore Structure for Puviyan Rewards System

## 📊 Current vs Required Structure

### ❌ Current State (Your App)
```
informationsPrivate/{uid}
├── email
├── email_verified
├── health_connections
├── notification_prefs
├── providers
├── createdAt
└── updatedAt

❌ NO points/rewards data exists
```

### ✅ Required Structure (Two Options)

---

## Option 1: Use Existing `informationsPrivate` (RECOMMENDED)

**Why?** Matches your current app structure, simpler queries, all user data in one place.

### Structure:
```javascript
informationsPrivate/{uid}
{
  // Existing fields
  email: "user@example.com",
  email_verified: true,
  health_connections: [],
  notification_prefs: {...},
  providers: ["google"],
  createdAt: timestamp,
  updatedAt: timestamp,
  
  // NEW: Points fields
  points: 1000,                    // Current balance
  pointsEarned: 5000,              // Total earned
  pointsRedeemed: 4000,            // Total redeemed
  pointsLastUpdated: timestamp
}

// Optional: Transaction history subcollection
informationsPrivate/{uid}/pointsTransactions/{transactionId}
{
  type: "earn" | "redeem" | "refund",
  points: 100,
  source: "challenge_completed" | redemptionId,
  timestamp: timestamp,
  balanceAfter: 1100,
  metadata: {...}
}
```

### API Changes:
- ✅ Updated `points.service.v2.js` (already created)
- ✅ Reads/writes to `informationsPrivate/{uid}`
- ✅ Backward compatible with existing user data

---

## Option 2: Separate Points Collection

**Why?** Better separation of concerns, easier to add complex points features later.

### Structure:
```javascript
users/{uid}/points/balance
{
  balance: 1000,
  earned: 5000,
  redeemed: 4000,
  lastUpdated: timestamp
}

users/{uid}/points/{transactionId}
{
  type: "earn" | "redeem" | "refund",
  points: 100,
  source: "challenge_completed",
  timestamp: timestamp,
  balanceAfter: 1100
}
```

### API Changes:
- ✅ Current `points.service.js` (already implemented)
- ⚠️ Requires creating new collection structure

---

## 🎯 Recommendation: Use Option 1

**Reasons:**
1. ✅ No migration needed - just add fields to existing documents
2. ✅ Fewer Firestore reads (1 read vs 2 reads)
3. ✅ Consistent with your app's current structure
4. ✅ Simpler to implement in Flutter app
5. ✅ All user data in one place

---

## 🔧 Implementation Steps

### Step 1: Update API to Use Option 1

Replace `points.service.js` with `points.service.v2.js`:

```bash
cd /Users/Sangisharvesh/CascadeProjects/puviyan-api
mv src/services/points.service.js src/services/points.service.old.js
mv src/services/points.service.v2.js src/services/points.service.js
```

### Step 2: Initialize Points for Existing Users

Run this script to add points fields to existing users:

```javascript
// initialize-user-points.js
const admin = require('firebase-admin');
// ... (script to add points: 0 to all existing users)
```

### Step 3: Update Flutter App

When user earns points (e.g., completes challenge):

```dart
// In your Flutter app
await FirebaseFirestore.instance
  .collection('informationsPrivate')
  .doc(userId)
  .update({
    'points': FieldValue.increment(100),
    'pointsEarned': FieldValue.increment(100),
    'pointsLastUpdated': FieldValue.serverTimestamp()
  });
```

---

## 📋 Required Firestore Collections

### 1. informationsPrivate (EXISTING - just add fields)
```javascript
{
  // Your existing fields...
  points: 0,              // Add this
  pointsEarned: 0,        // Add this
  pointsRedeemed: 0,      // Add this
  pointsLastUpdated: timestamp  // Add this
}
```

### 2. partners (NEW)
```javascript
partners/{partnerId}
{
  name: "Cafe XYZ",
  logo: "https://...",
  category: "cafe",
  location: {
    address: "123 Street",
    city: "Chennai",
    coordinates: { lat: 13.0827, lng: 80.2707 }
  },
  redemptionRate: 10,     // 10 points = ₹1
  isActive: true,
  apiKey: "encrypted_key",
  offers: [...],
  createdAt: timestamp,
  stats: {
    totalRedemptions: 0,
    totalPointsRedeemed: 0
  }
}
```

### 3. redemptions (NEW)
```javascript
redemptions/{redemptionId}
{
  redemptionId: "rdm_123",
  userId: "user_abc",
  partnerId: "partner_xyz",
  partnerName: "Cafe XYZ",
  points: 500,
  discount: 50,
  status: "initiated" | "reserved" | "confirmed" | "cancelled" | "expired",
  method: "qr" | "api" | "widget",
  qrToken: "jwt_token",
  createdAt: timestamp,
  reservedAt: timestamp,
  confirmedAt: timestamp,
  expiresAt: timestamp,
  partnerTransactionId: "pos_order_456",
  metadata: {...}
}
```

### 4. offers (NEW)
```javascript
offers/{offerId}
{
  offerId: "offer_1",
  partnerId: "partner_xyz",
  title: "Get ₹50 off",
  description: "...",
  minPoints: 500,
  maxDiscount: 50,
  category: "cafe",
  validFrom: timestamp,
  validUntil: timestamp,
  isActive: true,
  termsAndConditions: "..."
}
```

---

## 🚀 Next Steps

1. **Decide**: Option 1 (informationsPrivate) or Option 2 (separate collection)
2. **Update API**: Use the appropriate service file
3. **Initialize**: Add points fields to existing users
4. **Test**: Verify API works with your structure
5. **Integrate**: Update Flutter app to use new API

---

## ✅ Summary

**Your current structure:**
- ❌ No points/rewards system

**Recommended structure:**
- ✅ Add 4 fields to existing `informationsPrivate`
- ✅ Create 3 new collections (partners, redemptions, offers)
- ✅ Use `points.service.v2.js` in API

**Result:**
- ✅ Minimal changes to existing structure
- ✅ Full redemption system working
- ✅ Easy to integrate with Flutter app
