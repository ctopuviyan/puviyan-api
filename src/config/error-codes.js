/**
 * Puviyan Rewards API - Error Codes
 * 
 * Error Code Format: [CATEGORY]-[NUMBER]
 * 
 * Categories:
 * - AUTH: Authentication & Authorization errors
 * - VAL: Validation errors
 * - PTS: Points & Balance errors
 * - RWD: Rewards errors
 * - RDM: Redemption errors
 * - PTR: Partner errors
 * - USR: User errors
 * - SYS: System & Server errors
 */

const ERROR_CODES = {
  // ============================================
  // Authentication & Authorization (AUTH-001 to AUTH-099)
  // ============================================
  AUTH_UNAUTHORIZED: 'AUTH-001',
  AUTH_INVALID_TOKEN: 'AUTH-002',
  AUTH_EXPIRED_TOKEN: 'AUTH-003',
  AUTH_INVALID_API_KEY: 'AUTH-004',
  AUTH_FORBIDDEN: 'AUTH-005',
  AUTH_MISSING_HEADER: 'AUTH-006',
  AUTH_INVALID_CREDENTIALS: 'AUTH-007',

  // ============================================
  // Validation Errors (VAL-001 to VAL-099)
  // ============================================
  VAL_VALIDATION_ERROR: 'VAL-001',
  VAL_MISSING_FIELD: 'VAL-002',
  VAL_INVALID_VALUE: 'VAL-003',
  VAL_INVALID_DATE_RANGE: 'VAL-004',
  VAL_INVALID_REWARD_TYPE: 'VAL-005',
  VAL_INVALID_STATUS: 'VAL-006',
  VAL_INVALID_FORMAT: 'VAL-007',
  VAL_DUPLICATE_ENTRY: 'VAL-008',

  // ============================================
  // Points & Balance (PTS-001 to PTS-099)
  // ============================================
  PTS_INSUFFICIENT_BALANCE: 'PTS-001',
  PTS_ALREADY_RESERVED: 'PTS-002',
  PTS_NOT_FOUND: 'PTS-003',
  PTS_INVALID_AMOUNT: 'PTS-004',
  PTS_RESERVATION_FAILED: 'PTS-005',
  PTS_DEDUCTION_FAILED: 'PTS-006',
  PTS_RELEASE_FAILED: 'PTS-007',
  PTS_REFUND_FAILED: 'PTS-008',

  // ============================================
  // Rewards (RWD-001 to RWD-099)
  // ============================================
  RWD_NOT_FOUND: 'RWD-001',
  RWD_EXPIRED: 'RWD-002',
  RWD_NOT_ACTIVE: 'RWD-003',
  RWD_NOT_AVAILABLE: 'RWD-004',
  RWD_OUT_OF_STOCK: 'RWD-005',
  RWD_MAX_LIMIT_REACHED: 'RWD-006',
  RWD_ORG_RESTRICTED: 'RWD-007',
  RWD_CREATION_FAILED: 'RWD-008',
  RWD_UPDATE_FAILED: 'RWD-009',
  RWD_DELETE_FAILED: 'RWD-010',
  RWD_INVALID_TYPE: 'RWD-011',
  RWD_INVALID_COUPON_DATA: 'RWD-012',
  RWD_INVALID_DISCOUNT_DATA: 'RWD-013',

  // ============================================
  // Redemptions (RDM-001 to RDM-099)
  // ============================================
  RDM_NOT_FOUND: 'RDM-001',
  RDM_EXPIRED: 'RDM-002',
  RDM_ALREADY_USED: 'RDM-003',
  RDM_CANCELLED: 'RDM-004',
  RDM_INVALID_STATUS: 'RDM-005',
  RDM_ALREADY_CONFIRMED: 'RDM-006',
  RDM_CREATION_FAILED: 'RDM-007',
  RDM_CONFIRMATION_FAILED: 'RDM-008',
  RDM_CANCELLATION_FAILED: 'RDM-009',
  RDM_INVALID_QR_TOKEN: 'RDM-010',
  RDM_QR_EXPIRED: 'RDM-011',
  RDM_SCAN_FAILED: 'RDM-012',

  // ============================================
  // Partners (PTR-001 to PTR-099)
  // ============================================
  PTR_INVALID: 'PTR-001',
  PTR_NOT_FOUND: 'PTR-002',
  PTR_INACTIVE: 'PTR-003',
  PTR_ALREADY_EXISTS: 'PTR-004',
  PTR_CREATION_FAILED: 'PTR-005',
  PTR_UPDATE_FAILED: 'PTR-006',
  PTR_DELETE_FAILED: 'PTR-007',
  PTR_INVALID_API_KEY: 'PTR-008',
  PTR_API_KEY_GENERATION_FAILED: 'PTR-009',

  // ============================================
  // Users (USR-001 to USR-099)
  // ============================================
  USR_NOT_FOUND: 'USR-001',
  USR_INACTIVE: 'USR-002',
  USR_NOT_ORG_MEMBER: 'USR-003',
  USR_INVALID_ORG: 'USR-004',
  USR_PROFILE_INCOMPLETE: 'USR-005',
  USR_ALREADY_EXISTS: 'USR-006',
  USR_UPDATE_FAILED: 'USR-007',

  // ============================================
  // System & Server (SYS-001 to SYS-099)
  // ============================================
  SYS_INTERNAL_ERROR: 'SYS-001',
  SYS_DATABASE_ERROR: 'SYS-002',
  SYS_EXTERNAL_SERVICE_ERROR: 'SYS-003',
  SYS_RATE_LIMIT_EXCEEDED: 'SYS-004',
  SYS_TIMEOUT: 'SYS-005',
  SYS_CONFIGURATION_ERROR: 'SYS-006',
  SYS_FIREBASE_ERROR: 'SYS-007',
  SYS_TRANSACTION_FAILED: 'SYS-008'
};

const ERROR_MESSAGES = {
  // Authentication & Authorization
  'AUTH-001': 'Unauthorized access',
  'AUTH-002': 'Invalid authentication token',
  'AUTH-003': 'Authentication token has expired',
  'AUTH-004': 'Invalid API key provided',
  'AUTH-005': 'Access forbidden - insufficient permissions',
  'AUTH-006': 'Missing authorization header',
  'AUTH-007': 'Invalid credentials provided',

  // Validation
  'VAL-001': 'Validation error occurred',
  'VAL-002': 'Required field is missing',
  'VAL-003': 'Invalid field value provided',
  'VAL-004': 'Invalid date range specified',
  'VAL-005': 'Invalid reward type',
  'VAL-006': 'Invalid status value',
  'VAL-007': 'Invalid data format',
  'VAL-008': 'Duplicate entry detected',

  // Points & Balance
  'PTS-001': 'Insufficient points balance',
  'PTS-002': 'Points already reserved for another transaction',
  'PTS-003': 'User points record not found',
  'PTS-004': 'Invalid points amount specified',
  'PTS-005': 'Failed to reserve points',
  'PTS-006': 'Failed to deduct points',
  'PTS-007': 'Failed to release reserved points',
  'PTS-008': 'Failed to refund points',

  // Rewards
  'RWD-001': 'Reward not found',
  'RWD-002': 'Reward has expired',
  'RWD-003': 'Reward is not active',
  'RWD-004': 'Reward is not yet available',
  'RWD-005': 'Reward is out of stock',
  'RWD-006': 'Maximum redemption limit reached for this reward',
  'RWD-007': 'This reward is only available to specific organization members',
  'RWD-008': 'Failed to create reward',
  'RWD-009': 'Failed to update reward',
  'RWD-010': 'Failed to delete reward',
  'RWD-011': 'Invalid reward type specified',
  'RWD-012': 'Invalid coupon data provided',
  'RWD-013': 'Invalid discount data provided',

  // Redemptions
  'RDM-001': 'Redemption not found',
  'RDM-002': 'Redemption has expired',
  'RDM-003': 'Redemption already used',
  'RDM-004': 'Redemption has been cancelled',
  'RDM-005': 'Invalid redemption status',
  'RDM-006': 'Redemption already confirmed',
  'RDM-007': 'Failed to create redemption',
  'RDM-008': 'Failed to confirm redemption',
  'RDM-009': 'Failed to cancel redemption',
  'RDM-010': 'Invalid QR token provided',
  'RDM-011': 'QR code has expired',
  'RDM-012': 'Failed to scan QR code',

  // Partners
  'PTR-001': 'Invalid partner',
  'PTR-002': 'Partner not found',
  'PTR-003': 'Partner account is inactive',
  'PTR-004': 'Partner already exists',
  'PTR-005': 'Failed to create partner',
  'PTR-006': 'Failed to update partner',
  'PTR-007': 'Failed to delete partner',
  'PTR-008': 'Invalid partner API key',
  'PTR-009': 'Failed to generate partner API key',

  // Users
  'USR-001': 'User not found',
  'USR-002': 'User account is inactive',
  'USR-003': 'User is not a member of the required organization',
  'USR-004': 'Invalid organization specified',
  'USR-005': 'User profile is incomplete',
  'USR-006': 'User already exists',
  'USR-007': 'Failed to update user',

  // System & Server
  'SYS-001': 'Internal server error occurred',
  'SYS-002': 'Database operation failed',
  'SYS-003': 'External service error',
  'SYS-004': 'Rate limit exceeded - please try again later',
  'SYS-005': 'Request timeout',
  'SYS-006': 'System configuration error',
  'SYS-007': 'Firebase operation failed',
  'SYS-008': 'Transaction failed'
};

module.exports = {
  ERROR_CODES,
  ERROR_MESSAGES
};
