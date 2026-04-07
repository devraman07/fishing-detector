/**
 * Whitelist Service
 * Manages user-whitelisted domains in Redis (7-day TTL)
 */

const WHITELIST_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Add domain to whitelist
 */
export async function addToWhitelist(redis, domain, extensionId) {
  const key = `whitelist:${extensionId}:${domain}`;
  await redis.setex(key, WHITELIST_TTL_SECONDS, JSON.stringify({
    domain,
    addedAt: Date.now(),
    extensionId
  }));
  return { success: true, domain, ttl: WHITELIST_TTL_SECONDS };
}

/**
 * Check if domain is whitelisted
 */
export async function isWhitelisted(redis, domain, extensionId) {
  // Check exact domain
  const exactKey = `whitelist:${extensionId}:${domain}`;
  const exact = await redis.get(exactKey);
  if (exact) return true;
  
  // Check parent domains (for subdomains)
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parentDomain = parts.slice(i).join('.');
    const key = `whitelist:${extensionId}:${parentDomain}`;
    const result = await redis.get(key);
    if (result) return true;
  }
  
  return false;
}

/**
 * Remove domain from whitelist
 */
export async function removeFromWhitelist(redis, domain, extensionId) {
  const key = `whitelist:${extensionId}:${domain}`;
  await redis.del(key);
  return { success: true, domain };
}

/**
 * Get all whitelisted domains for extension
 */
export async function getWhitelist(redis, extensionId) {
  const pattern = `whitelist:${extensionId}:*`;
  const keys = await redis.keys(pattern);
  
  const entries = [];
  for (const key of keys) {
    const data = await redis.get(key);
    if (data) {
      const ttl = await redis.ttl(key);
      entries.push({ ...JSON.parse(data), ttl });
    }
  }
  
  return entries;
}

/**
 * Clean expired whitelist entries (called periodically)
 */
export async function cleanExpiredWhitelist(redis, extensionId) {
  const pattern = `whitelist:${extensionId}:*`;
  const keys = await redis.keys(pattern);
  let cleaned = 0;
  
  for (const key of keys) {
    const ttl = await redis.ttl(key);
    if (ttl <= 0) {
      await redis.del(key);
      cleaned++;
    }
  }
  
  return { cleaned, total: keys.length };
}
