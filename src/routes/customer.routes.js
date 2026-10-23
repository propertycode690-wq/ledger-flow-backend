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
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

const router = Router();

// All customer routes require authentication
router.use(requireAuth);

// List customers: Admin and Accountant only (Customers cannot browse other customers)
router.get('/', requireRole(['admin', 'accountant']), listCustomers);

// Financial statement: Admin and Accountant can view any; Customer role is isolated to own ID
router.get('/:id/statement', getCustomerStatement);

// Single customer: Admin and Accountant can view any; Customer role is isolated to own ID
router.get('/:id', getCustomerById);

// Write routes: Admin only
router.post('/', requireRole(['admin']), validateBody(createCustomerSchema), createCustomer);
router.put('/:id', requireRole(['admin']), validateBody(updateCustomerSchema), updateCustomer);
router.delete('/:id', requireRole(['admin']), deleteCustomer);

export default router;
