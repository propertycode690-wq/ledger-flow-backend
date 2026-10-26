import { Router } from 'express';
import {
  listPayments,
  getPaymentById,
  createPayment,
  voidPayment,
  createPaymentSchema,
  voidPaymentSchema,
} from '../controllers/payment.controller.js';
import { requireAuth, requirePermission } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { PERMISSIONS, hasPermission } from '../utils/permissions.js';

const router = Router();

// All payment routes require authentication
router.use(requireAuth);

function requirePaymentRead(req, res, next) {
  if (req.user.role === 'customer' || hasPermission(req.user, PERMISSIONS.PAYMENTS_VIEW)) {
    return next();
  }
  return res.status(403).json({
    status: 'error',
    code: 'FORBIDDEN',
    message: "Forbidden: Missing required permission 'payments:view'.",
  });
}

// Read routes: Accessible to Admin, permitted staff, and Customer (scoped to own account)
router.get('/', requirePaymentRead, listPayments);
router.get('/:id', requirePaymentRead, getPaymentById);

// Financial operations: Restricted to users with payments:create and payments:delete permissions
router.post('/', requirePermission(PERMISSIONS.PAYMENTS_CREATE), validateBody(createPaymentSchema), createPayment);
router.post('/:id/void', requirePermission(PERMISSIONS.PAYMENTS_DELETE), validateBody(voidPaymentSchema), voidPayment);

export default router;
