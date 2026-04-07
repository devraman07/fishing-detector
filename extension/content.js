// Runs on every page load — skip internal/extension pages
const url = window.location.href;
if (url.startsWith("http://") || url.startsWith("https://")) {
  /**
 * Secure Browse Guard - Content Script
 * Monitors page content and communicates with background script
 */

(function() {
  'use strict';
  
  // Prevent duplicate injections
  if (window.__sbgContentScriptInjected) return;
  window.__sbgContentScriptInjected = true;
  
  console.log('[SBG] Content script initialized on:', window.location.href);
  
  // Monitor for dynamically added links that might be suspicious
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check for suspicious iframes
          if (node.tagName === 'IFRAME') {
            const src = node.getAttribute('src');
            if (src && isSuspiciousIframe(src)) {
              console.warn('[SBG] Suspicious iframe detected:', src);
              // Could report to background for analysis
            }
          }
          
          // Check for password fields on suspicious domains
          if (node.tagName === 'INPUT' && node.type === 'password') {
            checkPasswordField(node);
          }
        }
      });
    });
  });
  
  // Start observing
  observer.observe(document.body, { childList: true, subtree: true });
  
  // Helper: Check if iframe source is suspicious
  function isSuspiciousIframe(src) {
    const suspiciousPatterns = [
      /password/i,
      /login/i,
      /signin/i,
      /auth/i,
      /banking/i,
      /paypal/i,
      /\.xyz$/,
      /\.tk$/,
      /\.ml$/
    ];
    return suspiciousPatterns.some(pattern => pattern.test(src));
  }
  
  // Helper: Check password field context
  function checkPasswordField(input) {
    const form = input.closest('form');
    if (form) {
      const formAction = form.getAttribute('action') || '';
      const formHost = formAction ? new URL(formAction, window.location.href).hostname : window.location.hostname;
      
      // If form submits to different domain, it might be phishing
      if (formHost && formHost !== window.location.hostname) {
        console.warn('[SBG] Password form submits to external domain:', formHost);
      }
    }
  }
  
  // Listen for messages from background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ping') {
      sendResponse({ success: true, url: window.location.href });
    }
    return false;
  });
  
  chrome.runtime.sendMessage({ type: "SCAN_URL", url }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("SecureBrowseGuard: Could not reach background script.", chrome.runtime.lastError.message);
    }
  });
})();
}
