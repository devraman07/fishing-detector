import axios from 'axios';

const ML_SERVER_URL = process.env.ML_SERVER_URL || 'http://localhost:5001';
const ML_TIMEOUT = parseInt(process.env.ML_TIMEOUT) || 5000;
const MAX_RETRIES = parseInt(process.env.ML_MAX_RETRIES) || 2;
const RETRY_DELAY = parseInt(process.env.ML_RETRY_DELAY) || 500;

/**
 * Call ML server with retry logic
 */
export async function callMLServer(url, retryCount = 0) {
  const startTime = Date.now();
  
  try {
    const response = await axios.post(
      `${ML_SERVER_URL}/scan`,
      { url },
      { timeout: ML_TIMEOUT }
    );
    
    const latency = Date.now() - startTime;
    
    // Transform response to standard format
    const result = {
      url: response.data.url || url,
      prediction: response.data.prediction || 'safe',
      confidence: response.data.confidence || 0,
      latency,
      source: 'ml'
    };
    
    return result;
    
  } catch (error) {
    // Retry on network errors or 5xx responses
    if (retryCount < MAX_RETRIES && 
        (error.code === 'ECONNREFUSED' || 
         error.code === 'ETIMEDOUT' ||
         (error.response && error.response.status >= 500))) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
      return callMLServer(url, retryCount + 1);
    }
    
    throw error;
  }
}

/**
 * Batch prediction support
 */
export async function callMLServerBatch(urls) {
  const startTime = Date.now();
  
  try {
    const response = await axios.post(
      `${ML_SERVER_URL}/scan/batch`,
      { urls },
      { timeout: ML_TIMEOUT * 2 }
    );
    
    const latency = Date.now() - startTime;
    
    return {
      results: response.data.results || [],
      latency,
      count: urls.length
    };
    
  } catch (error) {
    // Fallback to individual calls
    const results = await Promise.all(
      urls.map(url => callMLServer(url).catch(() => ({ url, prediction: 'safe', confidence: 0, error: true })))
    );
    
    return {
      results,
      latency: Date.now() - startTime,
      count: urls.length,
      fallback: true
    };
  }
}

/**
 * Health check for ML server
 */
export async function checkMLHealth() {
  try {
    const response = await axios.get(`${ML_SERVER_URL}/health`, { timeout: 3000 });
    return { ok: true, data: response.data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}


