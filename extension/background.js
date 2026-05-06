/**
 * Secure Browse Guard - Background Service Worker with REAL Blocking
 * Blocks phishing sites BEFORE they load using declarativeNetRequest
 */

import { CONFIG } from './config.js';

// ============ STATE MANAGEMENT ============
const scanCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const tempAllowlist = new Map(); // Temporary allowlist for "Proceed" functionality
const ALLOWLIST_TTL = 5 * 60 * 1000; // 5 minutes
const stats = { scanned: 0, blocked: 0, errors: 0, allowed: 0 };

let ruleIdCounter = 1000; // Start dynamic rules from ID 1000

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
  if (Date.now() - allowed.time > ALLOWLIST_TTL) {
    tempAllowlist.delete(domain);
    return false;
  }
  return true;
}

function addToTempAllowlist(url) {
  const domain = new URL(url).hostname;
  tempAllowlist.set(domain, { time: Date.now(), url });
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
    stats.allowed++;
    return;
  }
  
  console.log('[SBG] Scanning URL:', url);
  
  try {
    const result = await scanUrl(url);
    
    if (result.prediction === 'phishing' && result.confidence > 0.6) {
      console.log('[SBG] 🚫 BLOCKING phishing site:', url, result.confidence);
      stats.blocked++;
      
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
        // Remove block rule
        await removeBlockRule(ruleId);
        
        // Add to temporary allowlist
        addToTempAllowlist(blocked.url);
        
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
      return false;
      
    case 'scanUrl':
      scanUrl(request.url)
        .then(result => sendResponse({ success: true, data: result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'clearCache':
      scanCache.clear();
      sendResponse({ success: true });
      return false;
      
    case 'proceedAnyway':
      // Called from warning page
      addToTempAllowlist(request.url);
      sendResponse({ success: true });
      return false;
      
    default:
      return false;
  }
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
  
  // Clean allowlist
  for (const [key, value] of tempAllowlist.entries()) {
    if (now - value.time > ALLOWLIST_TTL) {
      tempAllowlist.delete(key);
    }
  }
  
  if (cleaned > 0) console.log(`[SBG] Cleaned ${cleaned} expired entries`);
}, 60 * 1000);

// Log initialization
chrome.runtime.onInstalled.addListener(() => {
  console.log('[SBG] Extension installed/updated');
});

console.log('[SBG] Background service worker initialized with REAL BLOCKING'); 

