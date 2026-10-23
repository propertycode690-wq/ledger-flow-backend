import { Router } from 'express';
import {
  listMileage,
  getMileageById,
  createMileage,
  updateMileage,
  deleteMileage,
  postMileageToExpense,
  listExpenses,
  createExpense,
  voidExpense,
  createMileageSchema,
  updateMileageSchema,
  createExpenseSchema,
  voidExpenseSchema,
} from '../controllers/mileage.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

const router = Router();

// All vehicle mileage & expense routes require Admin or Accountant authentication
router.use(requireAuth);
router.use(requireRole(['admin', 'accountant']));

// Vehicle Expenses endpoints
router.get('/expenses', listExpenses);
router.post('/expenses', validateBody(createExpenseSchema), createExpense);
router.post('/expenses/:id/void', validateBody(voidExpenseSchema), voidExpense);

// Mileage tracking endpoints
router.get('/', listMileage);
router.get('/:id', getMileageById);
router.post('/', validateBody(createMileageSchema), createMileage);
router.put('/:id', validateBody(updateMileageSchema), updateMileage);
router.post('/:id/post-expense', postMileageToExpense);

// Safe mileage deletion (Admin only)
router.delete('/:id', requireRole(['admin']), deleteMileage);

export default router;
