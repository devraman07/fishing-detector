import express from 'express';
import ScanController from '../Controllers/scanController.js';

const router = express.Router();

// Note: Rate limiting is handled at server level (scanLimiter middleware)
router.post('/', ScanController);

export default router;
