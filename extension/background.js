import { CONFIG } from "./config.js";

// Track recently scanned URLs to prevent duplicate requests
const recentScans = new Map();
const DEDUP_TTL = 300000; // 5 minutes

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SCAN_URL") {
    const url = message.url;
    
    // Deduplication: skip if recently scanned
    if (recentScans.has(url) && Date.now() - recentScans.get(url) < DEDUP_TTL) {
      return false; // Don't keep channel open, no response needed
    }
    recentScans.set(url, Date.now());
    
    // Must return true to keep the message channel open for async response
    handleScan(url, sender.tab?.id).then(sendResponse).catch((err) => {
      console.error("Scan failed:", err);
      sendResponse({ error: err.message });
    });
    return true;
  }
});

async function handleScan(url, tabId) {
  const response = await fetch(`${CONFIG.API_BASE}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    throw new Error(`Backend error: ${response.status}`);
  }

  const data = await response.json();

  if (data.result === "suspicious" && tabId != null) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: "SBG Security Alert",
      message: `Phishing detected: ${data.url || url}`
    });
  }

  return data;
}
