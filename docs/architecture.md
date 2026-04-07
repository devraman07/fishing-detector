# Secure Browse Guard - Architecture

## Overview

Secure Browse Guard (SBG) is a production-grade phishing detection system consisting of four main components working together to provide real-time protection against malicious websites.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Layer                                    │
│  ┌─────────────────────┐    ┌─────────────────────────────────────────┐  │
│  │ Chrome Extension    │    │ React Frontend (Developer/Admin Tool)   │  │
│  │ - Real-time blocking│    │ - Manual URL scanning                   │  │
│  │ - URL interception  │    │ - Analytics dashboard                   │  │
│  │ - Warning pages     │    │ - Scan history                          │  │
│  └──────────┬──────────┘    └──────────────────┬──────────────────────┘  │
└─────────────┼────────────────────────────────────┼──────────────────────────┘
              │                                    │
              │ HTTPS/HTTP                         │ HTTPS/HTTP
              │                                    │
┌─────────────▼────────────────────────────────────▼──────────────────────────┐
│                           API Gateway (Nginx)                              │
│  - SSL termination                                                          │
│ - Rate limiting                                                            │
│ - Request routing                                                          │
└─────────────┬────────────────────────────────────┬──────────────────────────┘
              │                                    │
              ▼                                    ▼
┌─────────────────────────────┐      ┌──────────────────────────────────────┐
│     Backend API (Node.js)   │      │   ML Server (Flask + TensorFlow)     │
│  ┌─────────────────────────┐│      │  ┌────────────────────────────────┐  │
│  │ - Express.js server    ││      │  │ - TensorFlow model            │  │
│  │ - Redis caching        ││      │  │ - URL tokenization            │  │
│  │ - Structured logging   ││      │  │ - Batch predictions           │  │
│  │ - Rate limiting        ││      │  │ - Health & metrics            │  │
│  │ - Request validation   ││◄────►│  │ - Latency tracking            │  │
│  └─────────────────────────┘│      │  └────────────────────────────────┘  │
└─────────────┬───────────────┘      └──────────────────────────────────────┘
              │
              │ Redis Protocol
              ▼
┌─────────────────────────────┐
│      Redis Cache            │
│  - Scan result cache (TTL)  │
│  - Statistics counters      │
│  - Rate limit tracking      │
└─────────────────────────────┘
```

## Component Details

### 1. Chrome Extension (Manifest V3)

**Purpose**: Browser-level phishing protection with real-time URL interception

**Key Features**:
- `webRequest` API for URL interception before page load
- `webNavigation` API for redirect handling
- In-memory LRU cache for scan results (5-min TTL)
- Warning page with "Proceed Anyway" bypass
- Service worker with retry logic

**Security Model**:
- Blocks suspicious URLs at network level
- Graceful degradation (allows if backend fails)
- Whitelist for localhost/private IPs
- Cache prevents repeated API calls

### 2. Backend API (Node.js + Express)

**Purpose**: REST API for URL scanning with caching and logging

**Key Features**:
- Redis caching layer (5-min TTL)
- Structured logging with Pino
- Rate limiting (30 scans/min per IP)
- Request ID tracking
- Retry logic for ML server calls
- Graceful fallback on ML failure

**API Standard**:
```json
{
  "success": true,
  "data": {
    "url": "https://example.com",
    "prediction": "safe|phishing",
    "confidence": 0.95,
    "latency": 45,
    "cached": false
  }
}
```

### 3. ML Server (Flask + TensorFlow)

**Purpose**: Deep learning model for URL classification

**Key Features**:
- LSTM-based phishing detection model
- Text tokenization and padding
- Batch prediction support (up to 32 URLs)
- Model warmup on startup
- Health endpoint with metrics
- Configurable threshold (default 0.7)

**Metrics Tracked**:
- Total requests
- Average latency
- Prediction distribution
- Error rate

### 4. React Frontend

**Purpose**: Developer/admin interface for manual scanning and analytics

**Key Features**:
- TailwindCSS responsive design
- Real-time URL scanning
- Scan history with persistence
- Analytics charts (Pie/Bar)
- Toast notifications
- Debounced auto-scan

## Data Flow

### URL Scan Flow

```
1. User visits URL
   │
   ▼
2. Extension intercepts via webRequest
   │
   ▼
3. Check in-memory cache
   ├── Cache HIT → Allow/Block immediately
   └── Cache MISS → Continue
   │
   ▼
4. Call Backend API (/api/scan)
   │
   ▼
5. Backend checks Redis cache
   ├── Cache HIT → Return cached result
   └── Cache MISS → Continue
   │
   ▼
6. Backend calls ML Server
   │
   ▼
7. ML Server tokenizes URL
   └── Runs TensorFlow prediction
   │
   ▼
8. Result flows back:
   ML → Backend (cache in Redis)
   Backend → Extension (cache in memory)
   Extension → Allow/Block decision
```

### Caching Strategy

| Layer | TTL | Purpose |
|-------|-----|---------|
| Extension Memory | 5 min | Prevent repeated browser API calls |
| Redis | 5 min | Shared cache across backend instances |
| ML Server | None | Stateless, no caching |

## Security Considerations

### Extension Security
- `webRequestBlocking` permission required
- Content Security Policy on warning pages
- No inline scripts (all external JS files)
- Extension ID validation on API calls

### Backend Security
- Helmet.js for HTTP headers
- CORS restricted to extension + frontend origins
- Rate limiting per IP
- Input validation with Zod
- No SQL injection (Redis key-value only)

### ML Server Security
- Runs in isolated container
- Read-only model volume
- No external network access required
- Health checks prevent traffic to unhealthy instances

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| End-to-end latency | < 2s | ~500ms |
| Cache hit rate | > 80% | Depends on traffic |
| ML inference | < 100ms | ~50ms |
| Concurrent users | 1000+ | TBD |

## Scaling Strategy

### Horizontal Scaling
- Backend: Stateless, can run multiple instances
- Redis: Single instance (can be clustered)
- ML Server: Can run multiple instances with load balancer

### Bottlenecks
1. **Redis**: Network latency between backend and Redis
2. **ML Server**: GPU/CPU bound for inference
3. **Extension Memory**: Limited by browser (recommend < 1000 entries)

## Technology Stack

| Component | Technology |
|-----------|------------|
| Extension | Chrome Manifest V3, vanilla JS |
| Frontend | React 18, Vite, TailwindCSS, Recharts |
| Backend | Node.js 18, Express, Pino, ioredis |
| ML | Python 3.10, Flask, TensorFlow 2.x |
| Cache | Redis 7 |
| Gateway | Nginx |
| CI/CD | GitHub Actions |
| Deployment | Docker Compose |

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Docker Host                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Nginx   │  │ Backend  │  │ ML Server│  │  Redis   │    │
│  │  :80/443 │  │  :5000   │  │  :5001   │  │  :6379   │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│       ▲                                                      │
│       │                                                      │
│   Internet                                                   │
└─────────────────────────────────────────────────────────────┘
```

## Monitoring & Observability

### Logs
- Structured JSON logs (Pino)
- Request ID correlation across services
- Log aggregation with Logtail/BetterStack

### Metrics
- Prometheus metrics endpoint on ML server
- Redis `INFO` command for cache stats
- Custom business metrics (scans, blocks, cache hits)

### Health Checks
- `/health` on all services
- Docker healthchecks with retries
- Nginx upstream health checks
