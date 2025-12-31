# Staging Deployment Guide

## 📋 Pre-Deployment Checklist

### ✅ **Completed**
- [x] Error codes implemented (categorized format)
- [x] Firestore indexes defined (`firestore.indexes.json`)
- [x] In-memory caching implemented
- [x] Organization-based rewards filtering
- [x] Validation for discount rewards
- [x] Rate limiting configured
- [x] CORS and security headers
- [x] Testing UI available

### ⏳ **Pending**
- [ ] Firebase staging project credentials
- [ ] Environment variables configured
- [ ] Firestore indexes deployed
- [ ] API deployed to Cloud Run
- [ ] Testing and verification

---

## 🔑 Required Firebase Information

Please provide the following from your Firebase Console:

### 1. **Firebase Project Details**
- Project ID: `_____________`
- Project Name: `_____________`
- Region: `_____________`

### 2. **Service Account Key**
Download from: Firebase Console → Project Settings → Service Accounts → Generate New Private Key

Save as: `firebase-service-account-staging.json`

### 3. **Firebase Config (for web/mobile)**
From: Firebase Console → Project Settings → General → Your apps

```json
{
  "apiKey": "_______________",
  "authDomain": "_______________.firebaseapp.com",
  "projectId": "_______________",
  "storageBucket": "_______________.appspot.com",
  "messagingSenderId": "_______________",
  "appId": "_______________"
}
```

---

## 🚀 Deployment Steps

### **Step 1: Configure Environment Variables**

Create `.env.staging` file:

```bash
# Firebase Configuration
FIREBASE_PROJECT_ID=your-staging-project-id
GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account-staging.json

# Server Configuration
NODE_ENV=staging
PORT=8080

# API Configuration
API_VERSION=v1
BASE_URL=https://your-staging-api.run.app

# Security
JWT_SECRET=your-staging-jwt-secret
PARTNER_API_KEY_SECRET=your-staging-partner-secret

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Points Configuration
MIN_REDEMPTION_POINTS=100
POINTS_TO_CURRENCY_RATE=10
MAX_REDEMPTION_AMOUNT=5000

# Token Expiry
REDEMPTION_TOKEN_EXPIRY=300
JWT_EXPIRY=15m
```

### **Step 2: Add Service Account Key**

```bash
# Place the downloaded service account key
cp ~/Downloads/firebase-service-account-staging.json ./firebase-service-account-staging.json

# Add to .gitignore (already done)
echo "firebase-service-account-*.json" >> .gitignore
```

### **Step 3: Deploy Firestore Indexes**

```bash
# Login to Firebase
firebase login

# Set staging project
firebase use --add
# Select your staging project and give it alias "staging"

# Deploy indexes
./deploy-indexes.sh staging

# Or manually:
firebase deploy --only firestore:indexes --project staging
```

### **Step 4: Deploy to Cloud Run**

```bash
# Build and deploy
./deploy.sh staging

# Or manually:
gcloud run deploy puviyan-api-staging \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=staging \
  --project your-staging-project-id
```

### **Step 5: Verify Deployment**

```bash
# Get the deployed URL
gcloud run services describe puviyan-api-staging \
  --platform managed \
  --region us-central1 \
  --format 'value(status.url)'

# Test health endpoint
curl https://your-staging-api.run.app/health

# Test rewards endpoint
curl https://your-staging-api.run.app/api/v1/rewards
```

---

## 🧪 Post-Deployment Testing

### **1. Health Check**
```bash
curl https://your-staging-api.run.app/health
```

Expected:
```json
{
  "status": "healthy",
  "timestamp": "2025-12-30T...",
  "environment": "staging"
}
```

### **2. Browse Rewards**
```bash
curl https://your-staging-api.run.app/api/v1/rewards
```

### **3. Testing UI**
Open: `https://your-staging-api.run.app/`

Test flows:
- [ ] Create partner
- [ ] Create reward (with orgId)
- [ ] Browse rewards (with userId)
- [ ] Reserve reward
- [ ] Scan QR code
- [ ] Confirm redemption

### **4. Check Firestore Indexes**
Firebase Console → Firestore → Indexes

Verify all indexes are built (not "Building...")

---

## 📊 Monitoring Setup

### **Cloud Run Metrics**
- Request count
- Request latency
- Error rate
- Instance count

### **Firestore Metrics**
- Document reads
- Document writes
- Index usage

### **Custom Logging**
```javascript
// Already implemented in error middleware
console.log('Request:', req.method, req.path);
console.error('Error:', error);
```

---

## 🔒 Security Checklist

- [ ] Service account key is NOT in git
- [ ] Environment variables are set
- [ ] CORS is configured for staging domain
- [ ] Rate limiting is enabled
- [ ] Firebase Auth is configured (for production)
- [ ] Partner API keys are secure

---

## 🐛 Troubleshooting

### **Issue: Indexes not found**
```
Error: The query requires an index
```

**Solution:**
```bash
firebase deploy --only firestore:indexes --project staging
```

Wait 5-10 minutes for indexes to build.

### **Issue: Service account authentication failed**
```
Error: Could not load the default credentials
```

**Solution:**
1. Check `GOOGLE_APPLICATION_CREDENTIALS` path
2. Verify service account key is valid
3. Ensure service account has required permissions

### **Issue: CORS errors**
```
Access-Control-Allow-Origin header is missing
```

**Solution:**
Check CORS configuration in `src/index.js`:
```javascript
app.use(cors({
  origin: ['https://your-staging-domain.com'],
  credentials: true
}));
```

---

## 📝 Next Steps After Staging

1. **Test thoroughly** with real Firebase users
2. **Monitor performance** and error rates
3. **Collect feedback** from testing
4. **Fix any issues** found
5. **Prepare for production** deployment

---

## 🎯 Production Deployment Differences

When moving to production:

1. **Environment**: Change `NODE_ENV=production`
2. **Firebase Project**: Use production project
3. **Domain**: Use production domain
4. **Secrets**: Use production secrets
5. **Monitoring**: Enable Cloud Monitoring alerts
6. **Backup**: Enable Firestore backups
7. **Auth**: Enable Firebase Auth (remove testing bypasses)

---

## 📞 Support

If you encounter issues:
1. Check Cloud Run logs: `gcloud run logs read --service puviyan-api-staging`
2. Check Firestore logs in Firebase Console
3. Review error codes in responses
4. Check this deployment guide

---

## ✅ Deployment Complete Checklist

- [ ] Firebase project created
- [ ] Service account key added
- [ ] Environment variables configured
- [ ] Firestore indexes deployed and built
- [ ] API deployed to Cloud Run
- [ ] Health check passes
- [ ] Testing UI accessible
- [ ] All endpoints tested
- [ ] Monitoring enabled
- [ ] Documentation updated

**Ready for real app integration!** 🚀
