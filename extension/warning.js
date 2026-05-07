/**
 * Secure Browse Guard - Warning Page Logic
 * Handles user interactions on the phishing warning page
 */

(function() {
  'use strict';
  
  // Get URL parameters (may be empty when navigated via DNR redirect)
  const urlParams = new URLSearchParams(window.location.search);
  let blockedUrl = safeDecode(urlParams.get('url') || '');
  let confidence = parseFloat(urlParams.get('confidence') || '0');
  
  // DOM Elements
  const blockedUrlEl = document.getElementById('blocked-url');
  const confidenceEl = document.getElementById('confidence-score');
  const threatLevelEl = document.getElementById('threat-level');
  const btnBlock = document.getElementById('block-btn');
  const btnProceed = document.getElementById('proceed-btn');

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  
  // Format URL for display (truncate if too long)
  function formatUrl(url) {
    if (!url) return 'Unknown';
    try {
      const urlObj = new URL(url);
      const display = `${urlObj.hostname}${urlObj.pathname}`;
      return display.length > 60 ? display.substring(0, 60) + '...' : display;
    } catch {
      return url.length > 60 ? url.substring(0, 60) + '...' : url;
    }
  }
  
  // Get threat level based on confidence
  function getThreatLevel(conf) {
    if (conf >= 0.9) return { level: 'Critical', class: 'critical' };
    if (conf >= 0.8) return { level: 'High', class: 'high' };
    if (conf >= 0.7) return { level: 'Medium', class: 'medium' };
    return { level: 'Low', class: 'low' };
  }
  
  // Initialize page
  async function init() {
    // When warning page is reached via DNR redirect, query params are not available.
    // Recover the blocked URL and metadata from chrome.storage.session using current tab id.
    if (!blockedUrl) {
      try {
        const tab = await getCurrentActiveTab();
        if (tab && typeof tab.id === 'number') {
          const sessionData = await chrome.storage.session.get([`blocked_${tab.id}`]);
          const blocked = sessionData[`blocked_${tab.id}`];
          if (blocked && blocked.url) {
            blockedUrl = blocked.url;
            confidence = typeof blocked.confidence === 'number' ? blocked.confidence : confidence;
          }
        }
      } catch (e) {
        console.warn('[SBG] Failed to recover blocked URL from session storage:', e);
      }
    }

    if (!blockedUrl) {
      blockedUrlEl.textContent = 'Error: No URL provided';
      confidenceEl.textContent = 'N/A';
      if (btnProceed) btnProceed.disabled = true;
      return;
    }
    
    // Display URL
    blockedUrlEl.textContent = formatUrl(blockedUrl);
    blockedUrlEl.title = blockedUrl; // Full URL on hover
    
    // Display confidence
    const confidencePercent = (confidence * 100).toFixed(1);
    confidenceEl.textContent = `${confidencePercent}%`;
    
    // Set threat level
    const threat = getThreatLevel(confidence);
    threatLevelEl.textContent = threat.level;
    threatLevelEl.classList.add(threat.class);
    
    // Button handlers
    if (btnBlock) btnBlock.addEventListener('click', keepBlocked);
    if (btnProceed) btnProceed.addEventListener('click', proceedAnyway);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') keepBlocked();
    });
    
    // Log warning displayed
    console.log(`[SBG] Warning displayed for: ${blockedUrl} (confidence: ${confidencePercent}%)`);
  }

  async function getCurrentActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs.length ? tabs[0] : null;
  }
  
  // Keep site blocked and navigate away from warning page
  async function keepBlocked() {
    try {
      const tab = await getCurrentActiveTab();
      await chrome.runtime.sendMessage({
        action: 'keepBlocked',
        url: blockedUrl,
        tabId: tab && typeof tab.id === 'number' ? tab.id : undefined
      });
    } catch (e) {
      console.warn('[SBG] Failed to send keepBlocked message:', e);
    }

    try {
      const tab = await getCurrentActiveTab();
      if (tab && typeof tab.id === 'number') {
        await chrome.tabs.update(tab.id, { url: 'chrome://newtab/' });
      } else {
        window.location.href = 'chrome://newtab/';
      }
    } catch {
      window.location.href = 'chrome://newtab/';
    }
  }
  
  // Proceed to blocked site (with confirmation)
  function proceedAnyway() {
    // Check if this was previously flagged (whitelist abuse warning)
    const wasPreviouslyFlagged = confidence >= 0.8;
    const abuseWarning = wasPreviouslyFlagged 
      ? `\n\n⚠️ CRITICAL: This site was previously FLAGGED as phishing with ${(confidence * 100).toFixed(1)}% confidence.\nBypassing this warning may compromise your security!` 
      : '';
    
    const confirmMessage = 
      `WARNING: You are about to visit a site flagged as phishing.\n\n` +
      `URL: ${blockedUrl}\n` +
      `Confidence: ${(confidence * 100).toFixed(1)}%\n\n` +
      `This site may try to steal your passwords, credit cards, or personal information.` +
      abuseWarning +
      `\n\nAre you absolutely sure you want to proceed?`;
    
    if (confirm(confirmMessage)) {
      // Disable button to prevent double-click
      btnProceed.disabled = true;
      btnProceed.textContent = 'Whitelisting...';

      if (btnBlock) btnBlock.disabled = true;
      
      // Notify background script about bypass with abuse metadata
      getCurrentActiveTab()
        .then((tab) => {
          chrome.runtime.sendMessage({
            action: 'proceedAnyway',
            url: blockedUrl,
            hostname: (() => {
              try { return new URL(blockedUrl).hostname; } catch { return undefined; }
            })(),
            tabId: tab && typeof tab.id === 'number' ? tab.id : undefined,
            reason: 'user_bypass',
            wasFlagged: wasPreviouslyFlagged,
            confidence: confidence
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('[SBG] Error proceeding:', chrome.runtime.lastError);
              window.location.href = blockedUrl;
              return;
            }

            if (response && response.success) {
              if (tab && typeof tab.id === 'number') {
                chrome.tabs.update(tab.id, { url: blockedUrl });
              } else {
                window.location.href = blockedUrl;
              }
              return;
            }

            console.warn('[SBG] Whitelist failed, navigating anyway');
            window.location.href = blockedUrl;
          });
        })
        .catch(() => {
          chrome.runtime.sendMessage({ action: 'proceedAnyway', url: blockedUrl }, () => {
            window.location.href = blockedUrl;
          });
        });
    }
  }
  
  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
