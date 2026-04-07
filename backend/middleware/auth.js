/**
 * Authentication Middleware for Extension API
 * Validates extension identity and API keys
 */

const API_SECRET = process.env.API_SECRET;
const ALLOWED_EXTENSION_IDS = process.env.ALLOWED_EXTENSION_IDS?.split(',') || [];

/**
 * Validate extension authentication headers
 */
export function validateExtensionAuth(req, res, next) {
  const extensionId = req.headers['x-extension-id'];
  const apiKey = req.headers['x-api-key'];
  const version = req.headers['x-extension-version'];
  
  // Log extension info for tracking
  if (extensionId) {
    req.extensionId = extensionId;
    req.extensionVersion = version;
    req.logger?.child({ extensionId, version });
  }
  
  // For scan endpoint, require authentication
  if (req.path === '/api/scan' || req.path === '/api/whitelist/add') {
    if (!extensionId || !apiKey) {
      req.logger?.warn({ ip: req.ip }, 'Missing authentication headers');
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Extension headers missing.'
      });
    }
    
    // Validate extension ID whitelist (if configured)
    if (ALLOWED_EXTENSION_IDS.length > 0 && !ALLOWED_EXTENSION_IDS.includes(extensionId)) {
      req.logger?.warn({ extensionId, ip: req.ip }, 'Extension not authorized');
      return res.status(403).json({
        success: false,
        error: 'Extension not authorized'
      });
    }
    
    // Validate API key format
    const expectedKey = 'sbg-ext-' + extensionId.substring(0, 16);
    if (apiKey !== expectedKey && apiKey !== API_SECRET) {
      req.logger?.warn({ extensionId, ip: req.ip }, 'Invalid API key');
      return res.status(403).json({
        success: false,
        error: 'Invalid API key'
      });
    }
    
    // Attach extension info to request for rate limiting
    req.extensionId = extensionId;
  }
  
  next();
}

/**
 * Per-extension rate limiting using Redis
 */
export function createExtensionRateLimiter(redis) {
  return async (req, res, next) => {
    const extensionId = req.extensionId || req.ip;
    const key = `rate_limit:${extensionId}`;
    
    try {
      const current = await redis.incr(key);
      
      // Set expiry on first request
      if (current === 1) {
        await redis.expire(key, 60); // 1-minute window
      }
      
      const limit = parseInt(process.env.SCAN_RATE_LIMIT_MAX) || 30;
      
      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current));
      
      if (current > limit) {
        req.logger?.warn({ extensionId, current, limit }, 'Rate limit exceeded');
        return res.status(429).json({
          success: false,
          error: `Rate limit exceeded. Max ${limit} scans per minute per extension.`
        });
      }
      
      next();
    } catch (error) {
      req.logger?.error({ error }, 'Rate limiter error');
      // Fail open if Redis error
      next();
    }
  };
}
