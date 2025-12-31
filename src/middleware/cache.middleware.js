/**
 * In-Memory Cache Middleware
 * Simple caching layer for frequently accessed data
 */

class CacheStore {
  constructor() {
    this.store = new Map();
  }

  set(key, value, ttl = 300000) { // Default 5 minutes
    const expiresAt = Date.now() + ttl;
    this.store.set(key, { value, expiresAt });
  }

  get(key) {
    const item = this.store.get(key);
    
    if (!item) {
      return null;
    }

    // Check if expired
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return item.value;
  }

  delete(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  // Clean up expired entries periodically
  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.store.entries()) {
      if (now > item.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  getStats() {
    return {
      size: this.store.size,
      keys: Array.from(this.store.keys())
    };
  }
}

// Create cache instances for different data types
const partnerCache = new CacheStore();
const rewardCache = new CacheStore();
const userOrgCache = new CacheStore();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  partnerCache.cleanup();
  rewardCache.cleanup();
  userOrgCache.cleanup();
}, 5 * 60 * 1000);

/**
 * Cache middleware for HTTP responses
 * Usage: app.get('/api/rewards', cacheMiddleware(300), handler)
 */
function cacheMiddleware(ttlSeconds = 300) {
  const cache = new Map();
  const ttl = ttlSeconds * 1000;

  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Create cache key from URL and query params
    const cacheKey = `${req.originalUrl || req.url}`;
    const cached = cache.get(cacheKey);

    if (cached && Date.now() < cached.expiresAt) {
      // Cache hit
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    // Cache miss - intercept response
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      // Only cache successful responses
      if (res.statusCode === 200) {
        cache.set(cacheKey, {
          data,
          expiresAt: Date.now() + ttl
        });
      }
      res.setHeader('X-Cache', 'MISS');
      return originalJson(data);
    };

    next();
  };
}

/**
 * Invalidate cache for specific patterns
 */
function invalidateCache(pattern) {
  // Clear all caches if pattern matches
  if (pattern.includes('rewards')) {
    rewardCache.clear();
  }
  if (pattern.includes('partners')) {
    partnerCache.clear();
  }
  if (pattern.includes('users')) {
    userOrgCache.clear();
  }
}

module.exports = {
  cacheMiddleware,
  partnerCache,
  rewardCache,
  userOrgCache,
  invalidateCache
};
