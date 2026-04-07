/**
 * Secure Browse Guard - Scanning Page Logic
 * Handles async URL scanning after redirect from webRequest
 */

(function() {
  'use strict';

  // Get target URL from query parameter
  const urlParams = new URLSearchParams(window.location.search);
  const rawTargetUrl = urlParams.get('target');
  let targetUrl = '';
  
  // Input validation: Validate and sanitize URL
  try {
    if (!rawTargetUrl) throw new Error('No URL provided');
    targetUrl = decodeURIComponent(rawTargetUrl);
    
    // Validate URL format
    const urlObj = new URL(targetUrl);
    
    // Security: Only allow http/https protocols
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('Invalid protocol');
    }
    
    // Security: Block data URLs, javascript URLs
    if (targetUrl.startsWith('data:') || targetUrl.startsWith('javascript:')) {
      throw new Error('Blocked protocol');
    }
    
    console.log('[SBG] Scanning page: Validated URL', targetUrl);
  } catch (e) {
    console.error('[SBG] Scanning page: Invalid URL', e);
    // Redirect to blank page on invalid URL
    window.location.href = 'about:blank';
    return;
  }
  
  // DOM elements
  const targetUrlEl = document.getElementById('target-url');
  const spinnerEl = document.getElementById('spinner');
  const statusEl = document.getElementById('status');
  const errorMsgEl = document.getElementById('error-message');
  const goBackBtn = document.getElementById('go-back');

  // Display target URL
  function displayUrl() {
    if (!targetUrl) {
      targetUrlEl.textContent = 'Error: No URL provided';
      showError();
      return false;
    }
    
    try {
      const urlObj = new URL(targetUrl);
      const display = `${urlObj.hostname}${urlObj.pathname}`;
      targetUrlEl.textContent = display.length > 60 ? display.substring(0, 60) + '...' : display;
      targetUrlEl.title = targetUrl;
      return true;
    } catch {
      targetUrlEl.textContent = targetUrl;
      return true;
    }
  }

  // Show error state
  function showError() {
    spinnerEl.style.display = 'none';
    statusEl.textContent = 'Scan failed';
    errorMsgEl.style.display = 'block';
    goBackBtn.style.display = 'inline-block';
  }

  // Go back to previous page
  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = 'chrome://newtab';
    }
  }
  // Expose to global scope for onclick handler
  window.goBack = goBack;

  // Perform async scan with timeout
  async function performScan() {
    if (!displayUrl()) return;

    console.log('[SBG] Scanning page: Starting scan for', targetUrl);

    // Timeout failsafe: 3 second max wait
    const TIMEOUT_MS = 3000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Scan timeout')), TIMEOUT_MS);
    });

    try {
      // Race between scan and timeout
      const response = await Promise.race([
        new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { action: 'scanUrl', url: targetUrl },
            (result) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else if (!result || !result.success) {
                reject(new Error(result?.error || 'Scan failed'));
              } else {
                resolve(result.data);
              }
            }
          );
        }),
        timeoutPromise
      ]);

      console.log('[SBG] Scanning page: Result received', response);

      // Handle result
      if (response.prediction === 'phishing' || response.prediction === 'suspicious') {
        // Block - redirect to warning page
        statusEl.textContent = 'Threat detected!';
        const warningUrl = chrome.runtime.getURL('warning.html') + 
          `?url=${encodeURIComponent(targetUrl)}&confidence=${response.confidence || 0.9}`;
        window.location.href = warningUrl;
      } else {
        // Safe - redirect to original URL
        statusEl.textContent = 'URL is safe. Redirecting...';
        
        // Mark as verified in background (secure session tracking)
        chrome.runtime.sendMessage({ action: 'markVerified', url: targetUrl });
        
        // Small delay for UX
        setTimeout(() => {
          window.location.href = targetUrl;
        }, 300);
      }

    } catch (error) {
      console.error('[SBG] Scanning page: Error during scan', error);
      
      // Fallback: try heuristics locally
      statusEl.textContent = 'Using offline check...';
      
      try {
        // Check if heuristics function is available
        if (typeof isClearlySuspicious === 'function') {
          if (isClearlySuspicious(targetUrl)) {
            console.log('[SBG] Scanning page: Blocked by local heuristic');
            const warningUrl = chrome.runtime.getURL('warning.html') + 
              `?url=${encodeURIComponent(targetUrl)}&reason=heuristic_fallback`;
            window.location.href = warningUrl;
            return;
          }
        }
      } catch (e) {
        console.log('[SBG] Scanning page: Heuristic check failed', e);
      }
      
      // Fail open - allow navigation
      statusEl.textContent = 'Unable to scan. Proceeding...';
      setTimeout(() => {
        window.location.href = targetUrl;
      }, 1000);
    }
  }

  // Handle keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      goBack();
    }
  });

  // Start scan on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', performScan);
  } else {
    performScan();
  }

})();
