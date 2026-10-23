import { Router } from 'express';
import { login, me, logout, loginSchema } from '../controllers/auth.controller.js';
import { requireAuth, requireRole, enforceCustomerScope } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

const router = Router();

// Core Authentication Endpoints
router.post('/login', validateBody(loginSchema), login);
router.get('/me', requireAuth, me);
router.post('/logout', requireAuth, logout);

// Role-Based Access Control Verification Endpoints
router.get('/admin-only', requireAuth, requireRole(['admin']), (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Welcome Admin: You have executive administrative privileges.',
    user: req.user,
  });
});

router.get('/accountant-only', requireAuth, requireRole(['admin', 'accountant']), (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Welcome Accountant: You have access to financial ledgers and VAT returns.',
    user: req.user,
  });
});

router.get('/customer-only', requireAuth, requireRole(['customer']), (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Welcome Client: You have access to your isolated customer portal.',
    user: req.user,
  });
});

// Customer Scope Isolation Verification Endpoint
router.get('/customer-data/:customerId', requireAuth, enforceCustomerScope, (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: `Access granted for customer account ${req.params.customerId}.`,
    customerId: req.params.customerId,
    requestingUser: req.user.email,
  });
});

export default router;
