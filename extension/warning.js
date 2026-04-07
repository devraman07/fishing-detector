/**
 * Secure Browse Guard - Warning Page Logic
 * Handles user interactions on the phishing warning page
 */

(function() {
  'use strict';
  
  // Get URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const blockedUrl = decodeURIComponent(urlParams.get('url') || '');
  const confidence = parseFloat(urlParams.get('confidence') || '0');
  
  // DOM Elements
  const blockedUrlEl = document.getElementById('blocked-url');
  const confidenceEl = document.getElementById('confidence-score');
  const threatLevelEl = document.getElementById('threat-level');
  const btnBack = document.getElementById('btn-back');
  const btnProceed = document.getElementById('btn-proceed');
  
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
  function init() {
    if (!blockedUrl) {
      blockedUrlEl.textContent = 'Error: No URL provided';
      confidenceEl.textContent = 'N/A';
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
    btnBack.addEventListener('click', goBack);
    btnProceed.addEventListener('click', proceedAnyway);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') goBack();
    });
    
    // Log warning displayed
    console.log(`[SBG] Warning displayed for: ${blockedUrl} (confidence: ${confidencePercent}%)`);
  }
  
  // Go back to previous page
  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      // If no history, go to new tab page
      window.location.href = 'chrome://newtab';
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
      
      // Notify background script about bypass with abuse metadata
      chrome.runtime.sendMessage({
        action: 'proceedAnyway',
        url: blockedUrl,
        reason: 'user_bypass',
        wasFlagged: wasPreviouslyFlagged,
        confidence: confidence
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[SBG] Error proceeding:', chrome.runtime.lastError);
          // Fallback: just navigate anyway
          window.location.href = blockedUrl;
        } else if (response && response.success) {
          console.log('[SBG] Whitelisted, navigating to:', blockedUrl);
          // Navigate after whitelist is confirmed
          window.location.href = blockedUrl;
        } else {
          console.warn('[SBG] Whitelist failed, navigating anyway');
          window.location.href = blockedUrl;
        }
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
