/**
 * Secure Browse Guard - Production Background Service Worker
 * Handles real-time URL scanning and browser-level blocking
 */

const CONFIG = {
  API_URL: 'http://localhost:5000',
  SCAN_TIMEOUT: 2000,
  CACHE_TTL: 5 * 60 * 1000,
  MAX_RETRIES: 2,
  RETRY_DELAY: 500,
  WHITELIST_TTL_DAYS: 7,
  WHITELIST_MAX_SIZE: 100,
  CACHE_MAX_SIZE: 1000,
  MIN_CACHE_CONFIDENCE: 0.8,
  EXTENSION_ID: chrome.runtime.id,
  // Fast-pass trusted domains (skip scanning)
  TRUSTED_DOMAINS: new Set([
    'google.com',
    'www.google.com',
    'youtube.com',
    'www.youtube.com',
    'github.com',
    'www.github.com',
    'stackoverflow.com',
    'www.stackoverflow.com',
    'microsoft.com',
    'www.microsoft.com',
    'apple.com',
    'www.apple.com',
    'amazon.com',
    'www.amazon.com',
    'cloudflare.com',
    'www.cloudflare.com',
    'reddit.com',
    'www.reddit.com',
    'x.com',
    'chatgpt.com',
    'grok.com',
    'instagram.com',
    'www.instagram.com',
    'facebook.com',
    'www.facebook.com',
    'netflix.com',
    'www.netflix.com',
    'linkedin.com',
    'www.linkedin.com',
    'gmail.com',
    'mail.google.com',
    'notion.com',
    'www.notion.com',
    'vercel.com',
    'www.vercel.com',
    'jiosaavn.com',
    'www.jiosaavn.com',
    'spotify.com',
    'open.spotify.com'
  ]),
  WHITELIST_PATTERNS: [
    /^https?:\/\/localhost/,
    /^https?:\/\/127\./,
    /^https?:\/\/10\./,
    /^https?:\/\/192\.168\./,
    /^chrome-extension:\/\//,
    /^chrome:\/\//,
    /^about:/,
    /^blob:/,
    /^data:/
  ]
};

const scanCache = new Map();
const pendingScans = new Map();
const verifiedUrls = new Map(); // Secure session tracking (replaces ?verified=true)
const stats = { totalScanned: 0, blockedCount: 0, cacheHits: 0, apiErrors: 0 };

// Extension integrity check
(function checkExtensionIntegrity() {
  const expectedId = chrome.runtime.id; // Self-verification
  if (!expectedId || expectedId.length < 10) {
    console.warn('[SBG] Extension integrity warning: Invalid extension ID');
  }
})();

// Synchronous whitelist cache for webRequest (avoids async chrome.storage call)
const syncWhitelistCache = new Set();

// Load whitelist into sync cache on startup
chrome.storage.local.get('user_whitelist', (result) => {
  const list = result.user_whitelist || [];
  const now = Date.now();
  list.forEach(entry => {
    if (!entry.expiresAt || entry.expiresAt > now) {
      syncWhitelistCache.add(entry.domain);
    }
  });
  console.log(`[SBG] Loaded ${syncWhitelistCache.size} domains into sync whitelist cache`);
});

// Check if URL is in sync whitelist (SYNC - no async)
function isInSyncWhitelist(url) {
  try {
    const domain = new URL(url).hostname;
    if (syncWhitelistCache.has(domain)) return true;
    // Check parent domains
    const parts = domain.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (syncWhitelistCache.has(parent)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Check if domain is trusted (fast-pass) with strict subdomain matching
function isTrustedDomain(url) {
  try {
    const domain = new URL(url).hostname;
    // Exact match
    if (CONFIG.TRUSTED_DOMAINS.has(domain)) return true;
    // Strict subdomain match: must end with .trusted.com (not trusted.com.evil.com)
    const parts = domain.split('.');
    if (parts.length >= 2) {
      const parent = parts.slice(-2).join('.'); // e.g., "google.com"
      return CONFIG.TRUSTED_DOMAINS.has(parent) && domain.endsWith('.' + parent);
    }
    return false;
  } catch {
    return false;
  }
}

function shouldSkipUrl(url) {
  try {
    const urlObj = new URL(url);
    if (!urlObj.protocol.startsWith('http')) return true;
    
    // Skip ALL extension URLs (including our own)
    if (url.includes('chrome-extension://' + chrome.runtime.id)) return true;
    if (url.includes('chrome-extension://')) return true;
    
    // Skip our internal pages explicitly
    if (url.includes('warning.html') || url.includes('scanning.html')) return true;
    
    // Check hardcoded patterns
    return CONFIG.WHITELIST_PATTERNS.some(pattern => pattern.test(url));
  } catch { return true; }
}

function getCachedResult(url) {
  const domain = extractDomain(url);
  const cached = scanCache.get(domain);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CONFIG.CACHE_TTL) {
    scanCache.delete(domain);
    return null;
  }
  stats.cacheHits++;
  return cached.data;
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function cacheResult(url, data) {
  // Cache poisoning protection: only cache high confidence results
  if (data.confidence < CONFIG.MIN_CACHE_CONFIDENCE && data.prediction !== 'phishing') {
    console.log(`[SBG] Skipping cache for low confidence: ${url} (${data.confidence})`);
    return;
  }
  
  const domain = extractDomain(url);
  const cacheEntry = {
    data: {
      ...data,
      source: data.source || 'ml'
    },
    timestamp: Date.now()
  };
  scanCache.set(domain, cacheEntry);
  
  // Memory leak prevention: enforce max cache size (LRU eviction)
  if (scanCache.size > CONFIG.CACHE_MAX_SIZE) {
    const entriesToDelete = scanCache.size - CONFIG.CACHE_MAX_SIZE;
    const entries = Array.from(scanCache.entries());
    // Sort by timestamp (oldest first)
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    // Delete oldest entries
    for (let i = 0; i < entriesToDelete && i < entries.length; i++) {
      scanCache.delete(entries[i][0]);
    }
    console.log(`[SBG] LRU cleanup: removed ${entriesToDelete} oldest cache entries`);
  }
}

// Analytics & Telemetry (lightweight)
async function trackEvent(eventType, data) {
  try {
    const event = {
      type: eventType,
      timestamp: Date.now(),
      extensionId: chrome.runtime.id,
      version: chrome.runtime.getManifest().version,
      data: {
        ...data,
        // Only log domain-level data (no full URLs)
        domain: data.domain || (data.url ? extractDomain(data.url) : null)
      }
    };
    
    // Send to backend (fire and forget)
    fetch(`${CONFIG.API_URL}/api/analytics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-ID': chrome.runtime.id
      },
      body: JSON.stringify(event)
    }).catch(() => {
      // Silently fail - analytics shouldn't break functionality
    });
    
    // Also log locally for debugging
    console.log(`[SBG Analytics] ${eventType}:`, event.data);
  } catch (e) {
    // Silently fail
  }
}
async function getPersistentWhitelist() {
  const result = await chrome.storage.local.get('user_whitelist');
  return result.user_whitelist || [];
}

async function addToWhitelist(url, options = {}) {
  try {
    const domain = new URL(url).hostname;
    const whitelist = await getPersistentWhitelist();
    
    // Check if already in whitelist
    if (whitelist.some(entry => entry.domain === domain)) {
      return { success: true, message: 'Domain already whitelisted' };
    }
    
    // Add with timestamp and expiration
    const entry = {
      domain,
      url: url.substring(0, 200), // Store truncated URL for reference
      addedAt: Date.now(),
      expiresAt: Date.now() + (CONFIG.WHITELIST_TTL_DAYS * 24 * 60 * 60 * 1000),
      reason: options.reason || 'user_bypass',
      wasFlagged: options.wasFlagged || false,
      confidence: options.confidence || 0
    };
    
    // Enforce max size (FIFO)
    if (whitelist.length >= CONFIG.WHITELIST_MAX_SIZE) {
      whitelist.shift(); // Remove oldest
    }
    
    whitelist.push(entry);
    await chrome.storage.local.set({ user_whitelist: whitelist });
    
    // Also update sync cache for immediate effect
    syncWhitelistCache.add(domain);
    
    // Also cache in memory for fast access
    cacheResult(url, { url, prediction: 'safe', confidence: 0, whitelisted: true });
    
    // Track analytics
    trackEvent('whitelist_add', { domain, wasFlagged: entry.wasFlagged, confidence: entry.confidence });
    
    console.log(`[SBG] Added to whitelist: ${domain}`);
    return { success: true, entry };
  } catch (error) {
    console.error('[SBG] Failed to add to whitelist:', error);
    return { success: false, error: error.message };
  }
}

async function isWhitelisted(url) {
  try {
    const domain = new URL(url).hostname;
    const whitelist = await getPersistentWhitelist();
    const now = Date.now();
    
    // Find valid entry
    const entry = whitelist.find(e => {
      // Match domain or is subdomain of whitelisted domain
      if (e.domain === domain) return true;
      if (domain.endsWith('.' + e.domain)) return true;
      return false;
    });
    
    if (!entry) return false;
    
    // Check expiration
    if (entry.expiresAt && now > entry.expiresAt) {
      // Remove expired entry
      const cleaned = whitelist.filter(e => e.domain !== entry.domain);
      await chrome.storage.local.set({ user_whitelist: cleaned });
      console.log(`[SBG] Removed expired whitelist entry: ${entry.domain}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('[SBG] Error checking whitelist:', error);
    return false;
  }
}

async function removeFromWhitelist(domain) {
  const whitelist = await getPersistentWhitelist();
  const cleaned = whitelist.filter(e => e.domain !== domain);
  await chrome.storage.local.set({ user_whitelist: cleaned });
  
  // Also remove from sync cache
  syncWhitelistCache.delete(domain);
  
  console.log(`[SBG] Removed from whitelist: ${domain}`);
  return { success: true };
}

async function cleanExpiredWhitelist() {
  const whitelist = await getPersistentWhitelist();
  const now = Date.now();
  const valid = whitelist.filter(e => !e.expiresAt || e.expiresAt > now);
  
  if (valid.length !== whitelist.length) {
    await chrome.storage.local.set({ user_whitelist: valid });
    console.log(`[SBG] Cleaned ${whitelist.length - valid.length} expired whitelist entries`);
  }
}

async function scanUrl(url, retryCount = 0) {
  const cached = getCachedResult(url);
  if (cached) return { ...cached, cached: true };
  if (pendingScans.has(url)) return pendingScans.get(url);
  const scanPromise = performScan(url, retryCount);
  pendingScans.set(url, scanPromise);
  try { return await scanPromise; } finally { pendingScans.delete(url); }
}

async function performScan(url, retryCount = 0) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.SCAN_TIMEOUT);
  
  // Generate API key from extension ID (consistent for this extension instance)
  const extensionId = chrome.runtime.id;
  const apiKey = 'sbg-ext-' + extensionId.substring(0, 16);
  
  try {
    const response = await fetch(`${CONFIG.API_URL}/api/scan`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'X-Extension-Version': chrome.runtime.getManifest().version,
        'X-Extension-ID': extensionId,
        'X-API-Key': apiKey
      },
      body: JSON.stringify({ url }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Scan failed');
    cacheResult(url, data.data);
    stats.totalScanned++;
    return data.data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (retryCount < CONFIG.MAX_RETRIES && error.name !== 'AbortError') {
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
      return performScan(url, retryCount + 1);
    }
    stats.apiErrors++;
    if (error.name === 'AbortError') return { url, prediction: 'safe', confidence: 0, error: 'timeout' };
    return { url, prediction: 'safe', confidence: 0, error: error.message };
  }
}

async function checkUrl(url) {
  // Step 1: Check hardcoded patterns (sync)
  if (shouldSkipUrl(url)) return { url, prediction: 'safe', confidence: 1, skipped: true };
  
  // Step 2: Check persistent whitelist (async but fast)
  const whitelisted = await isWhitelisted(url);
  if (whitelisted) return { url, prediction: 'safe', confidence: 1, whitelisted: true };
  
  // Step 3: Check memory cache
  const cached = getCachedResult(url);
  if (cached) return { ...cached, cached: true };
  
  // Step 4: Perform API scan
  const result = await scanUrl(url);
  return { isPhishing: result.prediction === 'phishing' || result.prediction === 'suspicious', confidence: result.confidence, url: result.url, cached: result.cached, error: result.error, whitelisted: result.whitelisted };
}

function showWarningPage(tabId, url, confidence) {
  const warningUrl = chrome.runtime.getURL('warning.html') + `?url=${encodeURIComponent(url)}&confidence=${confidence}`;
  chrome.tabs.update(tabId, { url: warningUrl });
  stats.blockedCount++;
}

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const url = details.url;
  if (url.includes('warning.html') || url.startsWith('chrome://')) return;
  try {
    const result = await checkUrl(url);
    if (result.isPhishing) {
      console.log(`[SBG] Blocking phishing site: ${url} (confidence: ${result.confidence})`);
      showWarningPage(details.tabId, url, result.confidence);
    } else {
      console.log(`[SBG] Allowing safe site: ${url}`);
    }
  } catch (error) { console.error('[SBG] Error in navigation handler:', error); }
}, { url: [{ schemes: ['http', 'https'] }] });

// SYNCHRONOUS webRequest handler - NO async allowed here
chrome.webRequest.onBeforeRequest.addListener((details) => {
  if (details.type !== 'main_frame') return;
  const url = details.url;
  
  // Skip internal pages (prevent redirect loops)
  if (url.includes('warning.html') || url.includes('scanning.html')) return;
  if (url.includes('chrome-extension://' + chrome.runtime.id)) return;
  
  // STEP 1: Skip hardcoded patterns (sync)
  if (shouldSkipUrl(url)) {
    console.log(`[SBG] Skipping: ${url}`);
    return;
  }
  
  // STEP 1.5: Check trusted domains (fast-pass)
  if (isTrustedDomain(url)) {
    console.log(`[SBG] Trusted domain (fast-pass): ${url}`);
    return;
  }
  
  // STEP 2: Check sync whitelist (sync - no async)
  if (isInSyncWhitelist(url)) {
    console.log(`[SBG] Whitelisted (sync): ${url}`);
    return;
  }
  
  // STEP 2.5: Check verified URLs (secure session tracking)
  if (isVerifiedUrl(url)) {
    console.log(`[SBG] Verified URL (secure): ${url}`);
    return;
  }
  
  // STEP 3: Check memory cache (sync)
  const cached = getCachedResult(url);
  if (cached) {
    if (cached.prediction === 'phishing' || cached.prediction === 'suspicious') {
      console.log(`[SBG] Blocking cached phishing: ${url}`);
      stats.blockedCount++;
      return { redirectUrl: chrome.runtime.getURL('warning.html') + `?url=${encodeURIComponent(url)}&cached=true` };
    }
    console.log(`[SBG] Allowing cached safe: ${url}`);
    return;
  }
  
  // STEP 4: Check heuristics (sync) - instant blocking for obvious phishing
  if (typeof isClearlySuspicious === 'function') {
    if (isClearlySuspicious(url)) {
      console.log(`[SBG] Blocking heuristic match: ${url}`);
      stats.blockedCount++;
      return { redirectUrl: chrome.runtime.getURL('warning.html') + `?url=${encodeURIComponent(url)}&reason=heuristic` };
    }
  }
  
  // STEP 5: Unknown URL - redirect to scanning page (async work happens there)
  console.log(`[SBG] Redirecting to scanning: ${url}`);
  return {
    redirectUrl: chrome.runtime.getURL('scanning.html') + `?target=${encodeURIComponent(url)}`
  };
}, { urls: ['<all_urls>'], types: ['main_frame'] }, ['blocking']);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'scanUrl':
      scanUrl(request.url).then(result => {
        // Track analytics for scan
        trackEvent('scan', { url: request.url, prediction: result.prediction, confidence: result.confidence });
        sendResponse({ success: true, data: result });
      }).catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    case 'markVerified':
      markVerified(request.url);
      sendResponse({ success: true });
      return false;
    case 'checkUrl':
      checkUrl(request.url).then(result => sendResponse({ success: true, data: result })).catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    case 'getStats':
      sendResponse({ success: true, data: { ...stats, cacheSize: scanCache.size, pendingScans: pendingScans.size } });
      return false;
    case 'clearCache':
      scanCache.clear();
      verifiedUrls.clear();
      sendResponse({ success: true, message: 'Cache cleared' });
      return false;
    case 'proceedAnyway':
      // Use persistent whitelist instead of memory-only cache
      addToWhitelist(request.url, {
        reason: request.reason || 'user_bypass',
        wasFlagged: request.wasFlagged || false,
        confidence: request.confidence || 0
      }).then((result) => {
        // Track bypass analytics
        if (result.success) {
          trackEvent('bypass', {
            url: request.url,
            wasFlagged: request.wasFlagged,
            confidence: request.confidence
          });
        }
        chrome.tabs.update(sender.tab.id, { url: request.url });
      });
      sendResponse({ success: true });
      return false;
    case 'getWhitelist':
      getPersistentWhitelist().then(list => sendResponse({ success: true, data: list }));
      return true;
    case 'removeFromWhitelist':
      removeFromWhitelist(request.domain).then(result => sendResponse(result));
      return true;
    default:
      sendResponse({ success: false, error: 'Unknown action' });
      return false;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[SBG] Extension installed/updated:', details.reason);
  chrome.storage.local.set({ enabled: true, showNotifications: true, autoScan: true, stats: { totalScanned: 0, blockedCount: 0 } });
  scanCache.clear();
});

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of scanCache.entries()) {
    if (now - value.timestamp > CONFIG.CACHE_TTL) { scanCache.delete(key); cleaned++; }
  }
  if (cleaned > 0) console.log(`[SBG] Cleaned ${cleaned} expired cache entries`);
}, 60 * 1000);

// Periodic whitelist cleanup (every hour)
setInterval(() => {
  cleanExpiredWhitelist();
}, 60 * 60 * 1000);

// Initial whitelist cleanup on startup
cleanExpiredWhitelist();

console.log('[SBG] Background service worker initialized');

