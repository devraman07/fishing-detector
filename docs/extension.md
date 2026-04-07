# Secure Browse Guard - Extension Documentation

## Overview

The Chrome Extension provides real-time browser-level phishing protection by intercepting navigation requests before pages load.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Browser                            │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  Manifest V3                          │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  │   │
│  │  │ Background  │  │ Content      │  │   Popup     │  │   │
│  │  │ Service     │  │ Script       │  │   UI        │  │   │
│  │  │ Worker      │  │              │  │             │  │   │
│  │  │             │  │ - DOM        │  │ - Stats     │  │   │
│  │  │ - webRequest│  │   observer   │  │ - Manual    │  │   │
│  │  │ - webNav    │  │ - Link       │  │   scan      │  │   │
│  │  │ - Caching   │  │   analysis   │  │ - Settings  │  │   │
│  │  └──────┬──────┘  └──────────────┘  └─────────────┘  │   │
│  │         │                                             │   │
│  │         ▼                                             │   │
│  │  ┌─────────────────────────────────────────────┐     │   │
│  │  │           Warning Page (blocked.html)       │     │   │
│  │  │  - Threat details                          │     │   │
│  │  │  - Proceed anyway (with confirmation)      │     │   │
│  │  │  - Go back to safety                       │     │   │
│  │  └─────────────────────────────────────────────┘     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ API calls
┌─────────────────────────────────────────────────────────────┐
│                  Backend API (Node.js)                      │
└─────────────────────────────────────────────────────────────┘
```

## Permissions

The extension requires these permissions:

```json
{
  "permissions": [
    "webRequest",
    "webRequestBlocking",
    "declarativeNetRequest",
    "storage",
    "tabs",
    "scripting",
    "activeTab"
  ],
  "host_permissions": [
    "<all_urls>"
  ]
}
```

**Permission Justification:**

| Permission | Purpose |
|------------|---------|
| `webRequest` | Intercept navigation requests |
| `webRequestBlocking` | Block/redirect requests before page loads |
| `declarativeNetRequest` | Alternative blocking method |
| `storage` | Persist settings and cache |
| `tabs` | Access current tab URL |
| `scripting` | Inject content scripts |
| `activeTab` | Access active tab for popup |
| `<all_urls>` | Scan any URL the user visits |

## Core Features

### 1. Real-time URL Blocking

**Mechanism:**
```javascript
// Primary: webRequest API (blocks before connection)
chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    const result = await checkUrl(details.url);
    if (result.isPhishing) {
      return { 
        redirectUrl: chrome.runtime.getURL('warning.html') + 
          `?url=${encodeURIComponent(details.url)}` 
      };
    }
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
  ['blocking']
);

// Secondary: webNavigation API (catches redirects)
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const result = await checkUrl(details.url);
  if (result.isPhishing) {
    chrome.tabs.update(details.tabId, { 
      url: chrome.runtime.getURL('warning.html') + 
        `?url=${encodeURIComponent(details.url)}` 
    });
  }
});
```

### 2. In-Memory Caching

**Cache Strategy:**
- LRU cache with 5-minute TTL
- Maximum 1000 entries
- Cache key: Full URL string
- Cache value: `{ data, timestamp }`

**Cache Behavior:**
```javascript
const scanCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedResult(url) {
  const cached = scanCache.get(url);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    scanCache.delete(url);
    return null;
  }
  return cached.data;
}
```

### 3. Warning Page

**Features:**
- Displays blocked URL
- Shows confidence score
- Shows threat level (Critical/High/Medium/Low)
- Lists potential risks
- "Go Back to Safety" button
- "Proceed Anyway" with confirmation dialog

**URL Parameters:**
- `url` - The blocked URL (URL-encoded)
- `confidence` - Detection confidence (0-1)

### 4. Retry Logic

**Configuration:**
```javascript
const CONFIG = {
  SCAN_TIMEOUT: 2000,      // 2 second timeout
  MAX_RETRIES: 2,           // Retry 2 times
  RETRY_DELAY: 500         // 500ms between retries
};
```

**Failure Handling:**
- If backend times out → Allow navigation (fail-open)
- If backend errors → Allow navigation with logging
- If ML server down → Allow navigation (graceful degradation)

## Installation

### From Source (Development)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension/` folder
5. Extension icon should appear in toolbar

### Production (Chrome Web Store)

1. Zip the `extension/` folder
2. Upload to Chrome Web Store Developer Dashboard
3. Submit for review
4. Once approved, users can install from store

## Configuration

### Extension Settings

Settings are stored in `chrome.storage.local`:

```javascript
chrome.storage.local.set({
  enabled: true,
  showNotifications: true,
  autoScan: true
});
```

### Backend URL

Update `CONFIG.API_URL` in `background.js`:

```javascript
const CONFIG = {
  API_URL: 'https://your-production-api.com'
};
```

## Testing

### Manual Testing Checklist

- [ ] Navigate to known phishing URL → Should block
- [ ] Navigate to safe URL → Should allow
- [ ] Type URL directly → Should scan
- [ ] Click link → Should scan
- [ ] JavaScript redirect → Should catch
- [ ] Popup shows current tab status
- [ ] Clear cache button works
- [ ] Warning page displays correctly
- [ ] "Proceed Anyway" works with confirmation
- [ ] Backend timeout → Allows (fail-open)

### Automated Testing

```javascript
// Example: Test navigation blocking
chrome.tabs.update(tabId, { url: 'https://known-phishing-site.com' });

// Wait for warning page
chrome.tabs.onUpdated.addListener((id, changeInfo, tab) => {
  if (tab.url.includes('warning.html')) {
    console.log('✓ Navigation blocked correctly');
  }
});
```

## Debugging

### Extension Console

1. Open `chrome://extensions/`
2. Find Secure Browse Guard
3. Click "background page" link (under Inspect views)
4. Console shows `[SBG]` prefixed logs

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Extension not blocking | Service worker inactive | Click extension icon to wake worker |
| API unreachable | Wrong backend URL | Check `CONFIG.API_URL` |
| Slow blocking | No cache | Cache builds over time |
| False positives | Model threshold too low | Adjust `THRESHOLD` env var |

## Security Considerations

### Content Security Policy

Warning pages use strict CSP:
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  style-src 'self' 'unsafe-inline';
  script-src 'self';
">
```

### URL Sanitization

All URLs are validated before processing:
```javascript
function shouldSkipUrl(url) {
  // Skip non-http(s)
  if (!url.startsWith('http')) return true;
  
  // Skip localhost/private IPs
  if (/^https?:\/\/localhost/.test(url)) return true;
  if (/^https?:\/\/127\./.test(url)) return true;
  if (/^https?:\/\/10\./.test(url)) return true;
  if (/^https?:\/\/192\.168\./.test(url)) return true;
  
  return false;
}
```

## Privacy

### Data Collection

The extension collects:
- URLs visited (sent to backend for scanning)
- Scan results (cached locally)
- Basic usage stats (total scanned, blocked)

### Data NOT Collected

- Page content
- Form data
- Cookies
- Browsing history (beyond current URL)
- Personal information

### Local-First Design

- Scan cache stored locally
- No user accounts required
- No telemetry without consent

## Troubleshooting

### Extension won't load
1. Check manifest.json syntax
2. Verify all referenced files exist
3. Check Chrome DevTools console for errors

### API calls failing
1. Check `CONFIG.API_URL` is correct
2. Verify backend is running
3. Check CORS configuration on backend
4. Look at background page console

### Blocking not working
1. Verify service worker is active
2. Check `webRequest` permission in manifest
3. Test with known phishing URL
4. Check background console for errors

## Development

### File Structure

```
extension/
├── manifest.json          # Extension config
├── background.js          # Service worker
├── content.js             # Page content script
├── popup.html             # Popup HTML
├── popup.js               # Popup logic
├── warning.html           # Block page HTML
├── warning.js             # Block page logic
├── warning.css            # Block page styles
├── rules.json             # Declarative rules
└── icons/                 # Extension icons
```

### Building

No build step required for extension - runs as plain JavaScript.

### Hot Reload

1. Make changes to files
2. Go to `chrome://extensions/`
3. Click refresh icon on SBG extension
4. Changes take effect immediately

---

## Resources

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [webRequest API](https://developer.chrome.com/docs/extensions/reference/webRequest/)
