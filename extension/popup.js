import { CONFIG } from "./config.js";

const statusEl = document.getElementById("status");

chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
  const url = tab?.url;
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    statusEl.textContent = "Nothing to scan on this page.";
    return;
  }

  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    const pct = (data.confidence * 100).toFixed(1);
    statusEl.innerHTML = `
      <span class="${data.result}">${data.result.toUpperCase()}</span><br/>
      Confidence: ${pct}%<br/>
      <small style="word-break:break-all">${url}</small>
    `;
  } catch (err) {
    statusEl.textContent = "Warning: Could not reach backend: " + err.message;
  }
});
