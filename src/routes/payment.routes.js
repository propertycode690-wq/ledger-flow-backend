import { Router } from 'express';
import {
  listPayments,
  getPaymentById,
  createPayment,
  voidPayment,
  createPaymentSchema,
  voidPaymentSchema,
} from '../controllers/payment.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

const router = Router();

// All payment routes require authentication
router.use(requireAuth);

// Read routes: Accessible to Admin, Accountant, and Customer (scoped to own account)
router.get('/', listPayments);
router.get('/:id', getPaymentById);

// Financial operations: Restricted to Admin and Accountant
router.post('/', requireRole(['admin', 'accountant']), validateBody(createPaymentSchema), createPayment);
router.post('/:id/void', requireRole(['admin', 'accountant']), validateBody(voidPaymentSchema), voidPayment);

export default router;
