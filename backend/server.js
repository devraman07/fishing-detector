/**
 * Secure Browse Guard - Production Backend Server
 * Features: Redis caching, structured logging, security, retry logic, validation
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import pino from 'pino';
import scanRoute from './routes/scan.js';
import { validateExtensionAuth, createExtensionRateLimiter } from './middleware/auth.js';
import whitelistRoute from './routes/whitelist.js';

dotenv.config();

// Initialize structured logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' 
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  base: { service: 'sbg-backend', version: '2.0.0' }
});

const app = express();

// Initialize Redis client (Redis Cloud compatible)
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  username: process.env.REDIS_USERNAME || undefined,
  db: parseInt(process.env.REDIS_DB) || 0,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error({ err }, 'Redis error'));

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:5173',
  'chrome-extension://*'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(allowed => {
      if (allowed.includes('*')) {
        const pattern = allowed.replace('/*', '');
        return origin.startsWith(pattern);
      }
      return allowed === origin;
    })) {
      callback(null, true);
    } else {
      logger.warn({ origin }, 'CORS blocked request');
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Extension-Version']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { success: false, error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn({ ip: req.ip, path: req.path }, 'Rate limit exceeded');
    res.status(429).json(options.message);
  }
});

// Stricter rate limiting for scan endpoint
const scanLimiter = rateLimit({
  windowMs: parseInt(process.env.SCAN_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
  max: parseInt(process.env.SCAN_RATE_LIMIT_MAX) || 30,
  message: { success: false, error: 'Scan rate limit exceeded' }
});

app.use(limiter);
app.use(express.json({ limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  req.requestId = uuidv4();
  req.startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    logger.info({
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('user-agent')?.substring(0, 50)
    }, 'Request completed');
  });
  
  next();
});

// Make redis available to routes
app.use((req, res, next) => {
  req.redis = redis;
  req.logger = logger.child({ requestId: req.requestId });
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const checks = {
    server: 'ok',
    timestamp: new Date().toISOString()
  };
  
  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch (err) {
    checks.redis = 'error';
    logger.error({ err }, 'Health check: Redis unavailable');
  }
  
  try {
    const axios = (await import('axios')).default;
    const mlUrl = process.env.ML_SERVER_URL || 'http://localhost:5001';
    await axios.get(`${mlUrl}/health`, { timeout: 5000 });
    checks.ml = 'ok';
  } catch (err) {
    checks.ml = 'error';
    logger.warn('Health check: ML server unavailable');
  }
  
  const isHealthy = checks.redis === 'ok' && checks.ml === 'ok';
  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    data: checks
  });
});

// Apply extension auth middleware
app.use(validateExtensionAuth);

// Apply per-extension rate limiting to scan endpoint
const extensionRateLimiter = createExtensionRateLimiter(redis);

// API routes
app.use('/api/scan', scanLimiter, extensionRateLimiter, scanRoute);
app.use('/api/whitelist', whitelistRoute);

// Stats endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const scanned = await redis.get('stats:total_scanned') || '0';
    const blocked = await redis.get('stats:blocked') || '0';
    const cacheSize = await redis.dbsize();
    
    res.json({
      success: true,
      data: {
        totalScanned: parseInt(scanned),
        blockedCount: parseInt(blocked),
        cacheSize
      }
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get stats');
    res.status(500).json({ success: false, error: 'Failed to get stats' });
  }
});

// Analytics endpoint for extension telemetry
app.post('/api/analytics', async (req, res) => {
  try {
    const { type, data, extensionId } = req.body;
    
    // Validate event type
    const validTypes = ['scan', 'block', 'whitelist_add', 'bypass', 'error'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid event type' });
    }
    
    // Log analytics event (domain-level only, no full URLs)
    req.logger.info({
      eventType: type,
      extensionId,
      domain: data?.domain,
      prediction: data?.prediction,
      confidence: data?.confidence,
      wasFlagged: data?.wasFlagged
    }, 'Analytics event');
    
    // Store in Redis for aggregation
    const eventKey = `analytics:${type}:${new Date().toISOString().split('T')[0]}`;
    await redis.hincrby(eventKey, 'count', 1);
    await redis.expire(eventKey, 30 * 24 * 60 * 60); // 30 day retention
    
    res.json({ success: true });
  } catch (err) {
    req.logger.error({ err }, 'Analytics error');
    res.status(500).json({ success: false, error: 'Analytics processing failed' });
  }
});
app.get('/', (_req, res) => {
  res.json({
    success: true,
    data: {
      service: 'Secure Browse Guard API',
      version: '2.0.0',
      status: 'running',
      documentation: '/api/docs'
    }
  });
});

// 404 handler
app.use((req, res) => {
  logger.warn({ path: req.path, method: req.method }, 'Route not found');
  res.status(404).json({ success: false, error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, _next) => {
  req.logger.error({ err }, 'Unhandled error');
  res.status(500).json({ 
    success: false, 
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message 
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await redis.quit();
  process.exit(0);
});

const PORT = parseInt(process.env.PORT) || 5000;
app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Server started');
});

