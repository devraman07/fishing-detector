/**
 * Secure Browse Guard - Background Service Worker with REAL Blocking
 * Blocks phishing sites BEFORE they load using declarativeNetRequest
 */

import { CONFIG } from './config.js';

// ============ STATE MANAGEMENT ============
const scanCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const tempAllowlist = new Map(); // hostname -> { expiresAt, url }

async function initRuleIdCounter() {
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const maxId = rules.reduce((acc, r) => (r && typeof r.id === 'number' ? Math.max(acc, r.id) : acc), 999);
    ruleIdCounter = Math.max(1000, maxId + 1);
  } catch (e) {
    // Keep default
  }
}
const ALLOWLIST_TTL = 5 * 60 * 1000; // 5 minutes
const stats = { scanned: 0, blocked: 0, errors: 0, allowed: 0 };

let ruleIdCounter = 1000; // Start dynamic rules from ID 1000

const STORAGE_KEYS = {
  allowlist: 'tempAllowlist'
};

const ALARM_CLEANUP = 'allowlistCleanup';

async function loadAllowlistFromStorage() {
  try {
    const data = await chrome.storage.local.get([STORAGE_KEYS.allowlist]);
    const stored = data[STORAGE_KEYS.allowlist];
    if (!stored || typeof stored !== 'object') return;
    const now = Date.now();
    for (const [hostname, entry] of Object.entries(stored)) {
      if (!entry || typeof entry.expiresAt !== 'number') continue;
      if (entry.expiresAt > now) {
        tempAllowlist.set(hostname, { expiresAt: entry.expiresAt, url: entry.url });
      }
    }
  } catch (e) {
    console.warn('[SBG] Failed to load allowlist from storage:', e);
  }
}

async function persistAllowlistToStorage() {
  try {
    const obj = {};
    for (const [hostname, entry] of tempAllowlist.entries()) {
      obj[hostname] = { expiresAt: entry.expiresAt, url: entry.url };
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.allowlist]: obj });
  } catch (e) {
    console.warn('[SBG] Failed to persist allowlist to storage:', e);
  }
}

async function cleanupExpiredAllowlistEntries() {
  const now = Date.now();
  let changed = false;
  for (const [hostname, entry] of tempAllowlist.entries()) {
    if (!entry || typeof entry.expiresAt !== 'number' || entry.expiresAt <= now) {
      try {
        const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
        const hasRule = dynamicRules.some((r) => r && r.condition && r.condition.urlFilter === `||${hostname}`);
        if (!hasRule && entry && entry.url) {
          await addBlockRule(entry.url);
        }
      } catch (e) {
        console.warn('[SBG] Failed to restore block rule after allowlist expiry:', e);
      }
      tempAllowlist.delete(hostname);
      changed = true;
    }
  }
  if (changed) await persistAllowlistToStorage();
}

async function removeBlockRulesForHostname(hostname) {
  if (!hostname) return;
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    const toRemove = rules
      .filter((r) => r && r.condition && r.condition.urlFilter === `||${hostname}`)
      .map((r) => r.id);

    if (toRemove.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove });
      console.log('[SBG] Removed block rule(s) for', hostname, toRemove);
    }
  } catch (e) {
    console.warn('[SBG] Failed to remove block rule(s) for hostname:', hostname, e);
  }
}

chrome.runtime.onStartup.addListener(() => {
  loadAllowlistFromStorage();
  initRuleIdCounter();
});

chrome.runtime.onInstalled.addListener(() => {
  loadAllowlistFromStorage();
  initRuleIdCounter();
  chrome.alarms.create(ALARM_CLEANUP, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === ALARM_CLEANUP) {
    cleanupExpiredAllowlistEntries();
  }
});

// ============ URL VALIDATION ============
function shouldSkipUrl(url) {
  try {
    const urlObj = new URL(url);
    if (!urlObj.protocol.startsWith('http')) return true;
    if (urlObj.hostname === 'localhost' || 
        urlObj.hostname.startsWith('127.') ||
        urlObj.hostname.startsWith('192.168.')) return true;
    if (url.includes('chrome-extension://')) return true;
    return false;
  } catch {
    return true;
  }
}

function isTempAllowed(url) {
  const domain = new URL(url).hostname;
  const allowed = tempAllowlist.get(domain);
  if (!allowed) return false;
  if (typeof allowed.expiresAt !== 'number' || Date.now() > allowed.expiresAt) {
    tempAllowlist.delete(domain);
    persistAllowlistToStorage();
    return false;
  }
  return true;
}

async function addToTempAllowlist(url) {
  const domain = new URL(url).hostname;
  const expiresAt = Date.now() + ALLOWLIST_TTL;
  tempAllowlist.set(domain, { expiresAt, url });
  await persistAllowlistToStorage();
  console.log('[SBG] Added to temporary allowlist:', domain);
}

// ============ DYNAMIC RULE MANAGEMENT ============
async function addBlockRule(url) {
  const domain = new URL(url).hostname;
  const ruleId = ruleIdCounter++;
  
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [{
        id: ruleId,
        priority: 2,
        action: {
          type: 'redirect',
          redirect: {
            extensionPath: '/warning.html'
          }
        },
        condition: {
          urlFilter: `||${domain}`,
          resourceTypes: ['main_frame']
        }
      }]
    });
    console.log('[SBG] Added block rule', ruleId, 'for', domain);
    return ruleId;
  } catch (err) {
    console.error('[SBG] Failed to add block rule:', err);
    return null;
  }
}

async function removeBlockRule(ruleId) {
  if (!ruleId) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleId]
    });
    console.log('[SBG] Removed block rule', ruleId);
  } catch (err) {
    console.error('[SBG] Failed to remove block rule:', err);
  }
}

// ============ SCANNING ============
async function scanUrl(url) {
  // Check cache first
  const cacheKey = new URL(url).hostname;
  const cached = scanCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    console.log('[SBG] Using cached result for:', url);
    return cached.data;
  }
  
  // Check temporary allowlist
  if (isTempAllowed(url)) {
    console.log('[SBG] URL temporarily allowed:', url);
    return { url, prediction: 'safe', confidence: 1, allowed: true };
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(`${CONFIG.API_BASE}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const result = await response.json();
    if (!result.success) throw new Error(result.error || 'Scan failed');
    
    // Cache result
    scanCache.set(cacheKey, { data: result.data, time: Date.now() });
    stats.scanned++;
    
    return result.data;
  } catch (error) {
    console.error('[SBG] Scan error:', error);
    stats.errors++;
    return { url, prediction: 'safe', confidence: 0, error: error.message };
  }
}

// ============ NOTIFICATIONS ============
function showPhishingNotification(url, confidence) {
  const domain = new URL(url).hostname;
  
  chrome.notifications.create(`phishing-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '⚠️ Phishing Site Blocked',
    message: `${domain} is dangerous (${Math.round(confidence * 100)}% confidence). Click Proceed to continue at your own risk.`,
    buttons: [
      { title: '⬅️ Go Back (Safe)' },
      { title: '⚠️ Proceed Anyway' }
    ],
    priority: 2,
    requireInteraction: true
  });
}

// ============ TAB MONITORING - REAL-TIME BLOCKING ============
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only process when URL changes (navigation starts)
  if (changeInfo.status !== 'loading' || !tab.url) return;
  
  const url = tab.url;
  
  // Skip internal URLs
  if (shouldSkipUrl(url)) return;
  
  // Check if temporarily allowed
  if (isTempAllowed(url)) {
    console.log('[SBG] Allowing temporarily whitelisted URL:', url);
    return;
  }
  
  console.log('[SBG] Scanning URL:', url);
  
  try {
    const result = await scanUrl(url);
    
    if (result.prediction === 'phishing' && result.confidence > 0.6) {
      console.log('[SBG] 🚫 BLOCKING phishing site:', url, result.confidence);
      
      // Store blocked info for this tab
      chrome.storage.session.set({ [`blocked_${tabId}`]: { url, confidence: result.confidence, time: Date.now() }});
      
      // Add blocking rule
      const ruleId = await addBlockRule(url);
      if (ruleId) {
        // Store rule ID so we can remove it later if user proceeds
        chrome.storage.session.set({ [`rule_${tabId}`]: ruleId });
      }
      
      // Show notification
      showPhishingNotification(url, result.confidence);
      
    } else {
      console.log('[SBG] ✅ Safe site:', url, result.prediction);
    }
  } catch (error) {
    console.error('[SBG] Error in tab update:', error);
  }
});

// Clean up storage when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove([`blocked_${tabId}`, `rule_${tabId}`]);
});

// ============ NOTIFICATION HANDLERS ============
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];
  
  if (buttonIndex === 0) {
    // Go Back - navigate to new tab page or history
    stats.blocked++;
    if (currentTab) {
      chrome.tabs.update(currentTab.id, { url: 'chrome://newtab/' });
    }
  } else if (buttonIndex === 1) {
    // Proceed Anyway - remove block rule and add to temp allowlist
    if (currentTab) {
      const data = await chrome.storage.session.get([`blocked_${currentTab.id}`, `rule_${currentTab.id}`]);
      const blocked = data[`blocked_${currentTab.id}`];
      const ruleId = data[`rule_${currentTab.id}`];
      
      if (blocked) {
        // Remove block rule(s)
        try {
          const hostname = new URL(blocked.url).hostname;
          await removeBlockRulesForHostname(hostname);
        } catch {
          await removeBlockRule(ruleId);
        }
        
        // Add to temporary allowlist
        await addToTempAllowlist(blocked.url);
        stats.allowed++;
        
        // Navigate to the URL
        chrome.tabs.update(currentTab.id, { url: blocked.url });
        
        // Clear storage
        chrome.storage.session.remove([`blocked_${currentTab.id}`, `rule_${currentTab.id}`]);
      }
    }
  }
  
  chrome.notifications.clear(notificationId);
});

// ============ MESSAGE HANDLERS ============
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    switch (request.action) {
      case 'getStats':
        sendResponse({
          success: true,
          data: {
            scanned: stats.scanned,
            blocked: stats.blocked,
            errors: stats.errors,
            allowed: stats.allowed,
            cacheSize: scanCache.size
          }
        });
        return;

      case 'scanUrl': {
        const result = await scanUrl(request.url);
        sendResponse({ success: true, data: result });
        return;
      }

      case 'clearCache':
        scanCache.clear();
        sendResponse({ success: true });
        return;

      case 'keepBlocked': {
        // User explicitly chose to keep blocking
        stats.blocked++;
        if (typeof request.tabId === 'number') {
          // Clear any session state for this tab
          await chrome.storage.session.remove([`blocked_${request.tabId}`, `rule_${request.tabId}`]);
        }

        sendResponse({ success: true });
        return;
      }

      case 'proceedAnyway': {
        const url = request.url;
        if (!url) {
          sendResponse({ success: false, error: 'Missing url' });
          return;
        }

        // Remove blocking rule(s) for this hostname so redirect stops immediately
        if (request.hostname) {
          await removeBlockRulesForHostname(request.hostname);
        } else if (typeof request.tabId === 'number') {
          // Fallback to per-tab rule id
          const data = await chrome.storage.session.get([`rule_${request.tabId}`]);
          const ruleId = data[`rule_${request.tabId}`];
          if (ruleId) await removeBlockRule(ruleId);
        }

        // Allow temporarily for 5 minutes
        await addToTempAllowlist(url);
        stats.allowed++;

        // Clear session state for this tab (so next warning can be fresh)
        if (typeof request.tabId === 'number') {
          await chrome.storage.session.remove([`blocked_${request.tabId}`, `rule_${request.tabId}`]);
        }

        sendResponse({ success: true });
        return;
      }

      default:
        sendResponse({ success: false, error: 'Unknown action' });
        return;
    }
  })().catch((error) => {
    console.error('[SBG] onMessage handler error:', error);
    sendResponse({ success: false, error: error && error.message ? error.message : String(error) });
  });

  return true;
});

// ============ MAINTENANCE ============
setInterval(() => {
  // Clean cache
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of scanCache.entries()) {
    if (now - value.time > CACHE_TTL) {
      scanCache.delete(key);
      cleaned++;
    }
  }
  
  // Clean allowlist (and restore blocking if needed)
  cleanupExpiredAllowlistEntries();
  
  if (cleaned > 0) console.log(`[SBG] Cleaned ${cleaned} expired entries`);
}, 60 * 1000);

// Log initialization
chrome.runtime.onInstalled.addListener(() => {
  console.log('[SBG] Extension installed/updated');
});

console.log('[SBG] Background service worker initialized with REAL BLOCKING'); 

