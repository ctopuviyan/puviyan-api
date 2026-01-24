const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');

// Load environment-specific .env file
const envFile = process.env.NODE_ENV === 'production' 
  ? '.env.production' 
  : process.env.NODE_ENV === 'staging' 
    ? '.env.stage' 
    : '.env';

require('dotenv').config({ path: path.resolve(process.cwd(), envFile) });

const { initializeFirebase } = require('./config/firebase.config');
const { errorHandler } = require('./middleware/error.middleware');

// Import routes
const rewardsRoutes = require('./routes/rewards.routes');
const rewardsManagementRoutes = require('./routes/rewards-management.routes');
const redemptionRoutes = require('./routes/redemption.routes');
const partnerRoutes = require('./routes/partner.routes');
const partnerPortalRoutes = require('./routes/partner-portal.routes');
const pointsRoutes = require('./routes/points.routes');
const adminRoutes = require('./routes/admin.routes');
const uploadRoutes = require('./routes/upload.routes');
const signupRoutes = require('./routes/signup.routes');
const organizationRoutes = require('./routes/organization.routes');
const userProfileRoutes = require('./routes/user-profile.routes');

const app = express();
const PORT = process.env.PORT || 8080;
const API_VERSION = process.env.API_VERSION || 'v1';

// Initialize Firebase Admin SDK
initializeFirebase();

// Middleware
// Configure Helmet with relaxed CSP for development/testing UI
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'", "'unsafe-hashes'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    }
  }
}));
app.use(compression());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Serve static files from public directory (testing UI)
app.use(express.static(path.join(__dirname, '../public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: API_VERSION
  });
});

// API routes
app.use(`/api/${API_VERSION}/rewards`, rewardsRoutes);
app.use(`/api/${API_VERSION}/rewards-management`, rewardsManagementRoutes);
app.use(`/api/${API_VERSION}/redemption`, redemptionRoutes);
app.use(`/api/${API_VERSION}/partners`, partnerRoutes);
app.use(`/api/${API_VERSION}/partner`, partnerPortalRoutes);
app.use(`/api/${API_VERSION}/points`, pointsRoutes);
app.use(`/api/${API_VERSION}/admin`, adminRoutes);
app.use(`/api/${API_VERSION}/upload`, uploadRoutes);
app.use(`/api/${API_VERSION}/organizations`, organizationRoutes);
app.use(`/api/${API_VERSION}/user`, userProfileRoutes);
app.use(`/api/${API_VERSION}`, signupRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} not found`
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Puviyan API server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
