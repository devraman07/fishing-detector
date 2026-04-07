# Secure Browse Guard - Deployment Guide

## Overview

This guide covers deploying Secure Browse Guard in production environments using Docker Compose with Nginx reverse proxy.

## Prerequisites

### Server Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 4 GB | 8+ GB |
| Disk | 20 GB | 50+ GB SSD |
| Network | 100 Mbps | 1 Gbps |
| OS | Ubuntu 20.04 | Ubuntu 22.04 LTS |

### Software Requirements

- Docker 20.10+
- Docker Compose 2.0+
- Git
- Make (optional)

## Quick Start

### 1. Clone Repository

```bash
git clone https://github.com/your-org/secure-browse-guard.git
cd secure-browse-guard
```

### 2. Configure Environment

#### Backend Environment

Create `backend/.env`:

```bash
# Server
NODE_ENV=production
PORT=5000
LOG_LEVEL=info

# Security
ALLOWED_ORIGINS=https://yourdomain.com,chrome-extension://*
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
SCAN_RATE_LIMIT_MAX=30

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=your-secure-password  # Optional

# ML Server
ML_SERVER_URL=http://ml-server:5001
ML_TIMEOUT=5000
ML_MAX_RETRIES=2

# Cache
CACHE_TTL_SECONDS=300
```

#### Frontend Environment

Create `frontend/.env`:

```bash
VITE_API_URL=https://yourdomain.com/api
```

### 3. SSL Certificates (Production)

For HTTPS, place certificates in `nginx/ssl/`:

```bash
mkdir -p nginx/ssl
cp your-cert.crt nginx/ssl/cert.pem
cp your-key.key nginx/ssl/key.pem
```

Or use Let's Encrypt:

```bash
# Install certbot
sudo apt install certbot

# Generate certificates
sudo certbot certonly --standalone -d yourdomain.com

# Copy to nginx folder
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/key.pem
```

### 4. Deploy

```bash
# Build and start all services
docker-compose up --build -d

# Verify services are running
docker-compose ps

# View logs
docker-compose logs -f

# Check specific service
docker-compose logs -f backend
```

### 5. Verify Deployment

```bash
# Health check
curl https://yourdomain.com/health

# Test scan
curl -X POST https://yourdomain.com/api/scan \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

## Production Checklist

### Security

- [ ] SSL/TLS enabled (HTTPS)
- [ ] Redis password set
- [ ] Backend `ALLOWED_ORIGINS` configured
- [ ] Rate limiting enabled
- [ ] Firewall rules configured (only 80/443/22 open)
- [ ] Regular security updates
- [ ] Secrets not committed to git

### Performance

- [ ] Redis persistence configured
- [ ] Nginx gzip enabled
- [ ] Nginx caching headers set
- [ ] Docker resource limits set
- [ ] Monitoring enabled

### Monitoring

- [ ] Health checks passing
- [ ] Log aggregation configured
- [ ] Alerts for service downtime
- [ ] Metrics collection enabled

### Backup

- [ ] Redis data backup strategy
- [ ] Model file backup
- [ ] Configuration backup

## Configuration Reference

### Docker Compose Overrides

Create `docker-compose.override.yml` for local development:

```yaml
version: '3.8'

services:
  backend:
    volumes:
      - ./backend:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
      - LOG_LEVEL=debug

  frontend:
    volumes:
      - ./frontend:/app
      - /app/node_modules
```

### Nginx Configuration

Production optimizations in `nginx/nginx.conf`:

```nginx
# Worker processes
worker_processes auto;
worker_rlimit_nofile 65535;

# Events
events {
    worker_connections 4096;
    use epoll;
    multi_accept on;
}

# HTTP
http {
    # Buffers
    client_body_buffer_size 128k;
    client_max_body_size 10m;
    client_header_buffer_size 1k;
    large_client_header_buffers 4 4k;
    
    # Timeouts
    client_body_timeout 12;
    client_header_timeout 12;
    keepalive_timeout 15;
    send_timeout 10;
    
    # Gzip
    gzip on;
    gzip_vary on;
    gzip_min_length 10240;
    gzip_proxied expired no-cache no-store private auth;
    gzip_types text/plain text/css text/xml application/json;
}
```

### Docker Resource Limits

Add to `docker-compose.yml`:

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 128M

  ml-server:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

## Scaling

### Horizontal Scaling

For high traffic, run multiple backend instances:

```yaml
services:
  backend:
    deploy:
      replicas: 3
    # Remove port mapping, use load balancer
```

Update Nginx upstream:

```nginx
upstream backend {
    server backend_1:5000;
    server backend_2:5000;
    server backend_3:5000;
}
```

### Redis Clustering

For production Redis clustering:

```yaml
services:
  redis-master:
    image: redis:7-alpine
    command: redis-server --appendonly yes

  redis-replica:
    image: redis:7-alpine
    command: redis-server --replicaof redis-master 6379
```

## Updates & Maintenance

### Updating Services

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose up --build -d

# Clean up old images
docker image prune -f
```

### Database Migration (if needed)

```bash
# Backup Redis
docker exec sbg_redis_1 redis-cli SAVE
docker cp sbg_redis_1:/data/dump.rdb ./backup/

# Restore Redis
docker cp ./backup/dump.rdb sbg_redis_1:/data/
docker restart sbg_redis_1
```

### Log Rotation

Docker handles log rotation by default. To customize:

```yaml
services:
  backend:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## Troubleshooting

### Services Won't Start

```bash
# Check logs
docker-compose logs

# Check specific service
docker-compose logs backend

# Verify environment variables
docker-compose config
```

### High Memory Usage

```bash
# Check container stats
docker stats

# Restart heavy containers
docker-compose restart ml-server
```

### SSL Issues

```bash
# Test certificate
openssl x509 -in nginx/ssl/cert.pem -text -noout

# Test HTTPS
curl -v https://yourdomain.com

# Check Nginx errors
docker-compose logs nginx
```

### Redis Connection Failed

```bash
# Verify Redis is running
docker-compose ps redis

# Check Redis logs
docker-compose logs redis

# Test connection
docker exec sbg_redis_1 redis-cli ping
```

## Monitoring Setup

### Basic Health Monitoring

Create `monitor.sh`:

```bash
#!/bin/bash

HEALTH_URL="https://yourdomain.com/health"
SLACK_WEBHOOK="your-slack-webhook-url"

response=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ $response -ne 200 ]; then
  curl -X POST -H 'Content-type: application/json' \
    --text '{"text":"SBG Health Check Failed! HTTP '$response'"}' \
    $SLACK_WEBHOOK
fi
```

Add to crontab:

```bash
*/5 * * * * /path/to/monitor.sh
```

### Prometheus Metrics (Optional)

Add to `docker-compose.yml`:

```yaml
services:
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
```

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/deploy.yml`):

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to server
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.HOST }}
          username: ${{ secrets.USERNAME }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /opt/sbg
            git pull origin main
            docker-compose up --build -d
            docker image prune -f
```

## Cost Estimation

### Self-Hosted (Recommended)

| Provider | Instance | Monthly Cost |
|----------|----------|--------------|
| AWS | t3.medium | ~$30 |
| DigitalOcean | 4GB/2CPU | ~$24 |
| Hetzner | CPX21 | ~$12 |
| Linode | 4GB Linode | ~$24 |

### Optional Add-ons

| Service | Monthly Cost |
|---------|--------------|
| Redis Cloud (managed) | Free tier available |
| Logtail | Free tier available |
| CloudFlare (CDN) | Free |

## Support

For deployment issues:

1. Check [Architecture Documentation](./architecture.md)
2. Review [API Documentation](./api.md)
3. Open GitHub issue with:
   - Deployment environment details
   - Error logs
   - Configuration (redact secrets)

---

**Last Updated:** January 2024  
**Version:** 2.0.0
