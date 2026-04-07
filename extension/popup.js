/**
 * Secure Browse Guard - Popup Script
 * Enhanced popup with real-time stats and manual scanning
 */

(function() {
  'use strict';
  
  const elements = {
    siteUrl: document.getElementById('site-url'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    scanResult: document.getElementById('scan-result'),
    resultBadge: document.getElementById('result-badge'),
    confidence: document.getElementById('confidence'),
    errorMessage: document.getElementById('error-message'),
    errorText: document.getElementById('error-text'),
    statScanned: document.getElementById('stat-scanned'),
    statBlocked: document.getElementById('stat-blocked'),
    statCache: document.getElementById('stat-cache'),
    btnManualScan: document.getElementById('btn-manual-scan'),
    btnClearCache: document.getElementById('btn-clear-cache')
  };
  
  let currentUrl = null;
  
  async function init() {
    await loadStats();
    await scanCurrentTab();
  }
  
  async function loadStats() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getStats' });
      if (response.success) {
        elements.statScanned.textContent = response.data.totalScanned;
        elements.statBlocked.textContent = response.data.blockedCount;
        elements.statCache.textContent = response.data.cacheSize;
      }
    } catch (err) {
      console.error('[SBG] Failed to load stats:', err);
    }
  }
  
  async function scanCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentUrl = tab?.url;
      
      if (!currentUrl || (!currentUrl.startsWith('http://') && !currentUrl.startsWith('https://'))) {
        elements.siteUrl.textContent = 'No website to scan';
        elements.statusText.textContent = 'Not applicable';
        elements.statusDot.className = 'status-dot';
        elements.scanResult.style.display = 'none';
        return;
      }
      
      elements.siteUrl.textContent = new URL(currentUrl).hostname;
      elements.statusDot.className = 'status-dot active';
      elements.statusText.textContent = 'Scanning...';
      elements.resultBadge.className = 'result-badge loading';
      elements.resultBadge.textContent = 'SCANNING';
      elements.scanResult.style.display = 'flex';
      elements.confidence.textContent = '--';
      elements.errorMessage.style.display = 'none';
      
      const response = await chrome.runtime.sendMessage({ action: 'checkUrl', url: currentUrl });
      
      if (!response.success) throw new Error(response.error);
      displayResult(response.data);
      
    } catch (err) {
      showError(err.message);
    }
  }
  
  function displayResult(result) {
    elements.scanResult.style.display = 'flex';
    
    if (result.error) {
      elements.statusDot.className = 'status-dot warning';
      elements.statusText.textContent = 'Scan Error';
      elements.resultBadge.className = 'result-badge loading';
      elements.resultBadge.textContent = 'UNKNOWN';
      elements.confidence.textContent = 'Error';
      return;
    }
    
    const confidence = (result.confidence * 100).toFixed(1);
    elements.confidence.textContent = `${confidence}%`;
    
    if (result.isPhishing) {
      elements.statusDot.className = 'status-dot danger';
      elements.statusText.textContent = 'Phishing Detected!';
      elements.resultBadge.className = 'result-badge suspicious';
      elements.resultBadge.textContent = 'DANGEROUS';
    } else {
      elements.statusDot.className = 'status-dot active';
      elements.statusText.textContent = result.cached ? 'Safe (Cached)' : 'Safe';
      elements.resultBadge.className = 'result-badge safe';
      elements.resultBadge.textContent = 'SAFE';
    }
  }
  
  function showError(message) {
    elements.errorMessage.style.display = 'block';
    elements.errorText.textContent = `Error: ${message}`;
    elements.statusDot.className = 'status-dot warning';
    elements.statusText.textContent = 'Scan Failed';
  }
  
  elements.btnManualScan.addEventListener('click', async () => {
    elements.btnManualScan.disabled = true;
    elements.btnManualScan.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
        <circle cx="12" cy="12" r="10"></circle>
      </svg>
      Scanning...
    `;
    await scanCurrentTab();
    elements.btnManualScan.disabled = false;
    elements.btnManualScan.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      Manual Scan
    `;
  });
  
  elements.btnClearCache.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ action: 'clearCache' });
      elements.statCache.textContent = '0';
      elements.btnClearCache.textContent = 'Cleared!';
      setTimeout(() => {
        elements.btnClearCache.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
          </svg>
          Clear Cache
        `;
      }, 1500);
    } catch (err) {
      console.error('[SBG] Failed to clear cache:', err);
    }
  });
  
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .spin { animation: spin 1s linear infinite; }
  `;
  document.head.appendChild(style);
  
  init();
})();
