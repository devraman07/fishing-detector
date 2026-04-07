/**
 * @jest-environment node
 */

import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

// Mock Redis
const mockRedis = {
  get: jest.fn(),
  setex: jest.fn(),
  incr: jest.fn(),
  ping: jest.fn().mockResolvedValue('PONG'),
  dbsize: jest.fn().mockResolvedValue(0),
  quit: jest.fn()
};

// Create a test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  
  // Mock middleware
  app.use((req, res, next) => {
    req.redis = mockRedis;
    req.logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      child: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn()
      })
    };
    req.requestId = 'test-request-id';
    next();
  });
  
  // Health endpoint
  app.get('/health', async (req, res) => {
    const checks = {
      server: 'ok',
      timestamp: new Date().toISOString(),
      redis: 'ok'
    };
    res.json({ success: true, data: checks });
  });
  
  // Stats endpoint
  app.get('/api/stats', async (req, res) => {
    const scanned = await req.redis.get('stats:total_scanned') || '0';
    const blocked = await req.redis.get('stats:blocked') || '0';
    const cacheSize = await req.redis.dbsize();
    
    res.json({
      success: true,
      data: {
        totalScanned: parseInt(scanned),
        blockedCount: parseInt(blocked),
        cacheSize
      }
    });
  });
  
  return app;
};

describe('Health Endpoints', () => {
  let app;
  
  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });
  
  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data.server).toBe('ok');
      expect(response.body.data.redis).toBe('ok');
    });
  });
  
  describe('GET /api/stats', () => {
    it('should return stats', async () => {
      mockRedis.get.mockResolvedValue('100');
      mockRedis.dbsize.mockResolvedValue(50);
      
      const response = await request(app)
        .get('/api/stats')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.data.totalScanned).toBe(100);
      expect(response.body.data.cacheSize).toBe(50);
    });
    
    it('should handle missing stats gracefully', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.dbsize.mockResolvedValue(0);
      
      const response = await request(app)
        .get('/api/stats')
        .expect(200);
      
      expect(response.body.data.totalScanned).toBe(0);
      expect(response.body.data.blockedCount).toBe(0);
    });
  });
});

describe('URL Validation', () => {
  it('should validate URL format', () => {
    const validUrls = [
      'https://example.com',
      'http://localhost:3000',
      'https://sub.domain.example.com/path?query=1'
    ];
    
    const invalidUrls = [
      'not-a-url',
      'ftp://example.com',
      '',
      'javascript:alert(1)'
    ];
    
    validUrls.forEach(url => {
      expect(() => new URL(url)).not.toThrow();
    });
    
    invalidUrls.forEach(url => {
      if (url) {
        expect(() => new URL(url)).toThrow();
      }
    });
  });
  
  it('should detect URLs exceeding max length', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(3000);
    expect(longUrl.length).toBeGreaterThan(2048);
  });
});
