import express from 'express';
import { addToWhitelist, isWhitelisted, removeFromWhitelist, getWhitelist } from '../services/whitelist.js';

const router = express.Router();

/**
 * POST /api/whitelist/add
 * Add a domain to the whitelist
 */
router.post('/add', async (req, res) => {
  const { url } = req.body;
  const extensionId = req.extensionId;
  const redis = req.redis;
  const logger = req.logger;
  
  if (!url) {
    return res.status(400).json({ success: false, error: 'URL required' });
  }
  
  try {
    const domain = new URL(url).hostname;
    const result = await addToWhitelist(redis, domain, extensionId);
    logger.info({ domain, extensionId }, 'Domain added to whitelist');
    res.json(result);
  } catch (error) {
    logger.error({ error }, 'Failed to add to whitelist');
    res.status(500).json({ success: false, error: 'Failed to add to whitelist' });
  }
});

/**
 * GET /api/whitelist/check
 * Check if a domain is whitelisted
 */
router.get('/check', async (req, res) => {
  const { domain } = req.query;
  const extensionId = req.extensionId;
  const redis = req.redis;
  
  if (!domain) {
    return res.status(400).json({ success: false, error: 'Domain required' });
  }
  
  try {
    const whitelisted = await isWhitelisted(redis, domain, extensionId);
    res.json({ success: true, domain, whitelisted });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Check failed' });
  }
});

/**
 * GET /api/whitelist
 * Get all whitelisted domains for this extension
 */
router.get('/', async (req, res) => {
  const extensionId = req.extensionId;
  const redis = req.redis;
  
  try {
    const entries = await getWhitelist(redis, extensionId);
    res.json({ success: true, entries, count: entries.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get whitelist' });
  }
});

/**
 * DELETE /api/whitelist/:domain
 * Remove domain from whitelist
 */
router.delete('/:domain', async (req, res) => {
  const { domain } = req.params;
  const extensionId = req.extensionId;
  const redis = req.redis;
  
  try {
    await removeFromWhitelist(redis, domain, extensionId);
    res.json({ success: true, domain, message: 'Removed from whitelist' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to remove' });
  }
});

export default router;
