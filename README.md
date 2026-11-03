# Puviyan API

Backend API for Puviyan rewards redemption system.

## Features

- 🎁 **Redemption System**: QR-based and API-based redemption
- 🏪 **Partner Management**: Manage partner stores and offers
- 🔐 **Authentication**: Firebase Auth integration
- 📊 **Analytics**: Track redemptions and partner performance
- 🛡️ **Security**: Rate limiting, JWT tokens, API key validation

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: Firebase Firestore
- **Authentication**: Firebase Admin SDK
- **Deployment**: Google Cloud Run

## Getting Started

### Prerequisites

- Node.js 18+ installed
- Firebase project with Firestore enabled
- Service account key for Firebase Admin SDK

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your configuration
nano .env

# Add your Firebase service account key
# Place it in the root directory as service-account.json
```

### Development

```bash
# Run in development mode with auto-reload
npm run dev

# Run in production mode
npm start

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

## API Endpoints

### Redemption APIs

```
POST   /api/v1/redemption/initiate       # User initiates redemption
POST   /api/v1/redemption/scan           # Partner scans QR
POST   /api/v1/redemption/confirm        # Confirm redemption
POST   /api/v1/redemption/rollback       # Cancel/refund
GET    /api/v1/redemption/history        # User's history
```

### Partner APIs

```
GET    /api/v1/partners                  # List all partners
GET    /api/v1/partners/:id              # Get partner details
POST   /api/v1/partners/:id/redemptions  # Partner's redemptions
GET    /api/v1/partners/:id/analytics    # Partner analytics
```

### Partner Mobile App

The iampuviyan Partner Flutter app shares this API. Projects, optional events, and private geotagged tree records use `/api/v1/partner-app/*`; existing portal and consumer routes retain their current paths. See [Partner mobile API](docs/PARTNER_APP_API.md) for endpoints, staging setup, and private photo storage. Run `npm run test:partner-app` for the isolated HTTP integration suite.

### Points APIs

```
GET    /api/v1/points/balance            # User's points balance
POST   /api/v1/points/calculate          # Calculate discount
GET    /api/v1/offers                    # Available offers
```

### Admin APIs

```
POST   /api/v1/admin/partners            # Create partner
PUT    /api/v1/admin/partners/:id        # Update partner
DELETE /api/v1/admin/partners/:id        # Delete partner
GET    /api/v1/admin/analytics           # System analytics
```

## Project Structure

```
puviyan-api/
├── src/
│   ├── routes/              # API route definitions
│   ├── controllers/         # Request handlers
│   ├── services/            # Business logic
│   ├── middleware/          # Express middleware
│   ├── utils/               # Utility functions
│   ├── config/              # Configuration files
│   └── index.js             # Entry point
├── tests/                   # Test files
├── package.json
├── .env.example
└── README.md
```

## Environment Variables

See `.env.example` for all available configuration options.

## Security

- All endpoints require authentication (Firebase ID token or Partner API key)
- Rate limiting enabled (100 requests per 15 minutes)
- JWT tokens for redemption with short expiry
- Input validation on all endpoints
- CORS configured for allowed origins only

## Deployment

### Google Cloud Run

```bash
# Build and deploy
gcloud run deploy puviyan-api \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

## Contributing

1. Create a feature branch
2. Make your changes
3. Write tests
4. Submit a pull request

## License

MIT
