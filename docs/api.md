# Secure Browse Guard - API Documentation

## Base URL

```
Development: http://localhost:5000
Production: https://your-domain.com
```

## Authentication

Currently no authentication required. Rate limiting is enforced per IP.

## Response Format

All responses follow this structure:

```json
{
  "success": true|false,
  "data": { ... },           // Present on success
  "error": "error message"   // Present on failure
}
```

## Endpoints

### Health Check

Check system health and dependencies.

**Endpoint:** `GET /health`

**Response:**
```json
{
  "success": true,
  "data": {
    "server": "ok",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "redis": "ok",
    "ml": "ok"
  }
}
```

**Status Codes:**
- `200` - All services healthy
- `503` - One or more services unhealthy

---

### Scan URL

Scan a single URL for phishing detection.

**Endpoint:** `POST /api/scan`

**Rate Limit:** 30 requests per minute per IP

**Request Body:**
```json
{
  "url": "https://example.com"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "url": "https://example.com",
    "prediction": "safe",
    "confidence": 0.95,
    "latency": 45,
    "source": "ml",
    "cached": false
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Invalid URL format"
}
```

**Error Response (422):**
```json
{
  "success": false,
  "error": "URL too long (max 2048 characters)"
}
```

**Error Response (429):**
```json
{
  "success": false,
  "error": "Scan rate limit exceeded"
}
```

**Error Response (500):**
```json
{
  "success": false,
  "error": "ML server unavailable, allowing by default",
  "data": {
    "url": "https://example.com",
    "prediction": "safe",
    "confidence": 0,
    "error": "ml_unavailable"
  }
}
```

**Prediction Values:**
- `safe` - URL is likely safe
- `phishing` - URL is likely a phishing attempt

---

### Get Statistics

Get system-wide scanning statistics.

**Endpoint:** `GET /api/stats`

**Response:**
```json
{
  "success": true,
  "data": {
    "totalScanned": 15420,
    "blockedCount": 342,
    "cacheSize": 892
  }
}
```

---

## Error Codes

| HTTP Code | Meaning | Description |
|-----------|---------|-------------|
| 200 | OK | Request successful |
| 400 | Bad Request | Invalid URL format |
| 404 | Not Found | Endpoint doesn't exist |
| 422 | Unprocessable | URL validation failed (too long, missing, etc.) |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Internal server error |
| 503 | Service Unavailable | Health check failed |

## Rate Limiting

- General API: 100 requests per minute per IP
- Scan endpoint: 30 requests per minute per IP

Rate limit headers are returned:
```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 28
X-RateLimit-Reset: 1705312200
```

## Caching

Scan results are cached in Redis with 5-minute TTL.

Cache key format: `scan:<base64(url)>`

## Example Usage

### cURL

```bash
# Scan a URL
curl -X POST http://localhost:5000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# Check health
curl http://localhost:5000/health

# Get stats
curl http://localhost:5000/api/stats
```

### JavaScript

```javascript
// Scan URL
const response = await fetch('http://localhost:5000/api/scan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://example.com' })
});

const data = await response.json();
console.log(data.data.prediction); // 'safe' or 'phishing'
```

### Python

```python
import requests

# Scan URL
response = requests.post('http://localhost:5000/api/scan', json={
    'url': 'https://example.com'
})

data = response.json()
print(data['data']['prediction'])
```

## WebSocket (Future)

Real-time scanning updates may be supported in future versions.

---

## Changelog

### v2.0.0
- Standardized response format with `success` field
- Added Redis caching layer
- Added structured logging
- Added rate limiting
- Added health check endpoint
- Graceful fallback on ML server failure

### v1.0.0
- Initial API
- Basic scanning functionality
- In-memory caching only
