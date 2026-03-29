# Secure Browse Guard (SBG)

A browser extension with ML-powered phishing detection, backed by a Node.js API and TensorFlow model.

## Project Structure

```
sbg/
├── backend/      # Express.js API server (Port 5000)
├── ml-server/    # Flask + TensorFlow ML service (Port 5001)
├── frontend/     # React + Vite dev interface (Port 5173)
├── extension/    # Chrome Extension (Manifest V3)
└── docker-compose.yml
```

## Running locally

```bash
cp backend/.env.example backend/.env
# Fill in DATABASE_URL in .env with your PostgreSQL connection string
docker compose up --build
```

Services will be available at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:5000
- ML Server: http://localhost:5001

## Environment Variables

### Backend (.env)
- `DATABASE_URL` - PostgreSQL connection string (required)
- `ML_SERVER_URL` - ML service URL (default: http://ml-server:5001)
- `ALLOWED_ORIGINS` - CORS origins (default: http://localhost:5173)
- `PORT` - Server port (default: 5000)

### ML Server (env)
- `MODEL_PATH` - Path to .h5 model file (default: model/phishing_model.h5)
- `TOKENIZER_PATH` - Path to tokenizer.pkl (default: model/tokenizer.pkl)
- `THRESHOLD` - Suspicious threshold 0-1 (default: 0.7)
- `PORT` - Server port (default: 5001)

## Architecture

1. **Extension** - Monitors browsing and scans URLs via content script
2. **Backend** - Express API with caching, rate limiting, and PostgreSQL logging
3. **ML Server** - Flask service with TensorFlow model for URL classification
4. **Frontend** - React UI for manual URL scanning

## Docker

All services run in containers with shared networking:
- Backend depends on ML server health check
- Shared `sbg-network` bridge network
- Volumes mounted for development
