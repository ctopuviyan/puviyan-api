# Error Code Migration Guide

## New Error Code Structure

Error codes are now categorized by domain:

| Category | Prefix | Range | Description |
|----------|--------|-------|-------------|
| Authentication | AUTH | 001-099 | Authentication & authorization errors |
| Validation | VAL | 001-099 | Input validation errors |
| Points | PTS | 001-099 | Points & balance operations |
| Rewards | RWD | 001-099 | Reward-related errors |
| Redemptions | RDM | 001-099 | Redemption process errors |
| Partners | PTR | 001-099 | Partner management errors |
| Users | USR | 001-099 | User-related errors |
| System | SYS | 001-099 | System & server errors |

## Migration Map

### Old → New Error Codes

```javascript
// Authentication
UNAUTHORIZED → AUTH_UNAUTHORIZED (AUTH-001)
INVALID_TOKEN → AUTH_INVALID_TOKEN (AUTH-002)
EXPIRED_TOKEN → AUTH_EXPIRED_TOKEN (AUTH-003)
INVALID_API_KEY → AUTH_INVALID_API_KEY (AUTH-004)

// Validation
VALIDATION_ERROR → VAL_VALIDATION_ERROR (VAL-001)
MISSING_REQUIRED_FIELD → VAL_MISSING_FIELD (VAL-002)
INVALID_FIELD_VALUE → VAL_INVALID_VALUE (VAL-003)

// Points
INSUFFICIENT_POINTS → PTS_INSUFFICIENT_BALANCE (PTS-001)
POINTS_NOT_FOUND → PTS_NOT_FOUND (PTS-003)

// Rewards
REWARD_NOT_FOUND → RWD_NOT_FOUND (RWD-001)
REWARD_EXPIRED → RWD_EXPIRED (RWD-002)
REWARD_NOT_ACTIVE → RWD_NOT_ACTIVE (RWD-003)
REWARD_NOT_AVAILABLE → RWD_NOT_AVAILABLE (RWD-004)
REWARD_OUT_OF_STOCK → RWD_OUT_OF_STOCK (RWD-005)
REWARD_MAX_LIMIT_REACHED → RWD_MAX_LIMIT_REACHED (RWD-006)
REWARD_ORG_RESTRICTED → RWD_ORG_RESTRICTED (RWD-007)

// Redemptions
REDEMPTION_NOT_FOUND → RDM_NOT_FOUND (RDM-001)
REDEMPTION_EXPIRED → RDM_EXPIRED (RDM-002)
ALREADY_REDEEMED → RDM_ALREADY_USED (RDM-003)
REDEMPTION_CANCELLED → RDM_CANCELLED (RDM-004)

// Partners
INVALID_PARTNER → PTR_INVALID (PTR-001)
PARTNER_NOT_FOUND → PTR_NOT_FOUND (PTR-002)
PARTNER_INACTIVE → PTR_INACTIVE (PTR-003)

// Users
USER_NOT_FOUND → USR_NOT_FOUND (USR-001)
USER_INACTIVE → USR_INACTIVE (USR-002)
USER_NOT_ORG_MEMBER → USR_NOT_ORG_MEMBER (USR-003)

// System
SERVER_ERROR → SYS_INTERNAL_ERROR (SYS-001)
DATABASE_ERROR → SYS_DATABASE_ERROR (SYS-002)
```

## Usage Examples

### Before:
```javascript
throw new ApiError(
  HTTP_STATUS.BAD_REQUEST,
  ERROR_CODES.INSUFFICIENT_POINTS,
  'Insufficient points balance'
);
```

### After:
```javascript
throw new ApiError(
  HTTP_STATUS.BAD_REQUEST,
  ERROR_CODES.PTS_INSUFFICIENT_BALANCE,
  'Insufficient points balance'
);
```

### Error Response Format

```json
{
  "errorCode": "RWD-001",
  "message": "Reward not found",
  "details": {
    "rewardId": "abc123"
  }
}
```

## Files to Update

1. ✅ `/src/config/error-codes.js` - Created
2. ✅ `/src/config/constants.js` - Updated to import error codes
3. ✅ `/src/middleware/error.middleware.js` - Updated to use new format
4. ⏳ `/src/services/*.js` - Need to update all service files
5. ⏳ `/src/middleware/auth.middleware.js` - Update auth errors
6. ⏳ `/src/middleware/rateLimit.middleware.js` - Update rate limit errors

## Next Steps

Run the following command to find all occurrences that need updating:

```bash
grep -r "ERROR_CODES\." src/ --include="*.js" | grep -v "error-codes.js" | grep -v "constants.js"
```
