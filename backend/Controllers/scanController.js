import { ZodError } from 'zod';
import { validateUrl } from '../utils/validator.js';
import { callMLServer } from '../services/mlClient.js';

const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS) || 300; // 5 minutes default

/**
 * Scan Controller - Production grade with Redis caching
 */
const ScanController = async (req, res) => {
  const logger = req.logger;
  const redis = req.redis;
  
  try {
    // Validate URL
    const { url } = validateUrl(req.body);
    
    // Additional URL validation
    try { 
      new URL(url); 
    } catch { 
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid URL format' 
      }); 
    }
    
    if (url.length > 2048) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL too long (max 2048 characters)' 
      });
    }
    
    // Generate cache key
    const cacheKey = `scan:${Buffer.from(url).toString('base64')}`;
    
    // Check Redis cache first
    const cachedResult = await redis.get(cacheKey);
    if (cachedResult) {
      logger.info({ url, cached: true }, 'Returning cached scan result');
      const parsed = JSON.parse(cachedResult);
      
      // Update stats
      await redis.incr('stats:total_scanned');
      
      return res.json({
        success: true,
        data: {
          ...parsed,
          cached: true
        }
      });
    }
    
    // Call ML server
    logger.info({ url }, 'Scanning URL with ML server');
    const prediction = await callMLServer(url);
    
    // Cache the result
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(prediction));
    
    // Update stats
    await redis.incr('stats:total_scanned');
    if (prediction.prediction === 'phishing') {
      await redis.incr('stats:blocked');
    }
    
    logger.info({ 
      url, 
      prediction: prediction.prediction, 
      confidence: prediction.confidence,
      latency: prediction.latency 
    }, 'Scan completed');
    
    // Return standardized response
    res.json({
      success: true,
      data: {
        ...prediction,
        cached: false
      }
    });
    
  } catch (error) {
    logger.error({ err: error }, 'Scan failed');
    
    if (error instanceof ZodError) {
      return res.status(422).json({ 
        success: false, 
        error: error.errors[0].message 
      });
    }
    
    // Handle ML server failures gracefully
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      logger.warn('ML server unavailable, allowing request');
      return res.json({
        success: true,
        data: {
          url: req.body.url,
          prediction: 'safe',
          confidence: 0,
          error: 'ml_unavailable',
          message: 'ML server unavailable, allowing by default'
        }
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: process.env.NODE_ENV === 'production' 
        ? 'Scan failed' 
        : error.message 
    });
  }
};

export default ScanController;
