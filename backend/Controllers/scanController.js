import { ZodError } from 'zod';
import { validateUrl } from '../utils/validator.js';
import { callMLServer } from '../services/mlClient.js';

/**
 * Scan Controller - Production grade without Redis caching
 */
const ScanController = async (req, res) => {
  const logger = req.logger;
  
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
    
    // Call ML server
    logger.info({ url }, 'Scanning URL with ML server');
    const prediction = await callMLServer(url);
    
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
