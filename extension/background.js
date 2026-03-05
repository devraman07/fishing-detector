chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SCAN_URL") {
    // Must return true to keep the message channel open for async response
    handleScan(message.url, sender.tab?.id).then(sendResponse).catch((err) => {
      console.error("Scan failed:", err);
      sendResponse({ error: err.message });
    });
    return true;
  }
});

async function handleScan(url, tabId) {
  const response = await fetch("http://localhost:5000/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    throw new Error(`Backend error: ${response.status}`);
  }

  const data = await response.json();

  if (data.result === "suspicious" && tabId != null) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (confidence) => {
        const pct = (confidence * 100).toFixed(1);
        alert(`⚠️ Suspicious Website Detected!\nConfidence: ${pct}%`);
      },
      args: [data.confidence]
    });
  }

  return data;
}
