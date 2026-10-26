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
import { requireAuth, requirePermission } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../utils/permissions.js';

const router = Router();

// All vehicle mileage & expense routes require authentication
router.use(requireAuth);

// Vehicle Expenses endpoints
router.get('/expenses', requirePermission(PERMISSIONS.MILEAGE_VIEW), listExpenses);
router.post('/expenses', requirePermission(PERMISSIONS.MILEAGE_CREATE), validateBody(createExpenseSchema), createExpense);
router.post('/expenses/:id/void', requirePermission(PERMISSIONS.MILEAGE_DELETE), validateBody(voidExpenseSchema), voidExpense);

// Mileage tracking endpoints
router.get('/', requirePermission(PERMISSIONS.MILEAGE_VIEW), listMileage);
router.get('/:id', requirePermission(PERMISSIONS.MILEAGE_VIEW), getMileageById);
router.post('/', requirePermission(PERMISSIONS.MILEAGE_CREATE), validateBody(createMileageSchema), createMileage);
router.put('/:id', requirePermission(PERMISSIONS.MILEAGE_CREATE), validateBody(updateMileageSchema), updateMileage);
router.post('/:id/post-expense', requirePermission(PERMISSIONS.MILEAGE_CREATE), postMileageToExpense);

// Mileage deletion
router.delete('/:id', requirePermission(PERMISSIONS.MILEAGE_DELETE), deleteMileage);

export default router;
