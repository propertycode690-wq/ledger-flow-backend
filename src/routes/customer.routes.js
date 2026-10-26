import { Router } from 'express';
import {
  listCustomers,
  getCustomerById,
  getCustomerStatement,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  createCustomerSchema,
  updateCustomerSchema,
} from '../controllers/customer.controller.js';
import { requireAuth, requirePermission } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { PERMISSIONS, hasPermission } from '../utils/permissions.js';

const router = Router();

// All customer routes require authentication
router.use(requireAuth);

function requireCustomerRead(req, res, next) {
  if (req.user.role === 'customer' || hasPermission(req.user, PERMISSIONS.CUSTOMERS_VIEW)) {
    return next();
  }
  return res.status(403).json({
    status: 'error',
    code: 'FORBIDDEN',
    message: "Forbidden: Missing required permission 'customers:view'.",
  });
}

// List customers: Staff with customers:view permission
router.get('/', requirePermission(PERMISSIONS.CUSTOMERS_VIEW), listCustomers);

// Financial statement & profile: staff with customers:view or customer reading own account
router.get('/:id/statement', requireCustomerRead, getCustomerStatement);
router.get('/:id', requireCustomerRead, getCustomerById);

// Write routes: Granularly authorized
router.post('/', requirePermission(PERMISSIONS.CUSTOMERS_CREATE), validateBody(createCustomerSchema), createCustomer);
router.put('/:id', requirePermission(PERMISSIONS.CUSTOMERS_EDIT), validateBody(updateCustomerSchema), updateCustomer);
router.delete('/:id', requirePermission(PERMISSIONS.CUSTOMERS_DELETE), deleteCustomer);

export default router;
