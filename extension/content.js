// Runs on every page load — skip internal/extension pages
const url = window.location.href;
if (url.startsWith("http://") || url.startsWith("https://")) {
  chrome.runtime.sendMessage({ type: "SCAN_URL", url }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("SecureBrowseGuard: Could not reach background script.", chrome.runtime.lastError.message);
    }
  });
}
