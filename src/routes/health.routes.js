import { Router } from 'express';
import { testDatabaseConnection } from '../config/db.js';

const router = Router();

/**
 * @route   GET /api/health
 * @desc    Basic server health check
 * @access  Public
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'ledgerflow-backend',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/**
 * @route   GET /api/db-health
 * @desc    Read-only MySQL database connectivity check
 * @access  Public
 */
router.get('/db-health', async (req, res) => {
  const check = await testDatabaseConnection();

  if (check.connected) {
    return res.status(200).json({
      status: 'ok',
      database: 'connected',
      provider: 'mysql',
      latencyMs: check.latencyMs,
      details: check.details,
      timestamp: new Date().toISOString(),
    });
  }

  return res.status(503).json({
    status: 'error',
    database: 'disconnected',
    provider: 'mysql',
    latencyMs: check.latencyMs,
    error: check.error,
    timestamp: new Date().toISOString(),
  });
});

export default router;
