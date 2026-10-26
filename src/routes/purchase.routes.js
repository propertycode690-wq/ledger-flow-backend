import { Router } from 'express';
import {
  listPurchases,
  getPurchaseById,
  createPurchase,
  updatePurchase,
  deletePurchase,
  listSuppliers,
  previewBatchImport,
  executeBatchImport,
  createPurchaseSchema,
  updatePurchaseSchema,
  batchImportSchema,
} from '../controllers/purchase.controller.js';
import { requireAuth, requirePermission } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../utils/permissions.js';

const router = Router();

// All purchases routes require authentication
router.use(requireAuth);

// Supplier catalog and batch migration routes (must precede /:id)
router.get('/suppliers', requirePermission(PERMISSIONS.PURCHASES_VIEW), listSuppliers);
router.post('/import-preview', requirePermission(PERMISSIONS.PURCHASES_CREATE), validateBody(batchImportSchema), previewBatchImport);
router.post('/import', requirePermission(PERMISSIONS.PURCHASES_CREATE), validateBody(batchImportSchema), executeBatchImport);

// Purchase bills CRUD routes
router.get('/', requirePermission(PERMISSIONS.PURCHASES_VIEW), listPurchases);
router.get('/:id', requirePermission(PERMISSIONS.PURCHASES_VIEW), getPurchaseById);
router.post('/', requirePermission(PERMISSIONS.PURCHASES_CREATE), validateBody(createPurchaseSchema), createPurchase);
router.put('/:id', requirePermission(PERMISSIONS.PURCHASES_EDIT), validateBody(updatePurchaseSchema), updatePurchase);
router.delete('/:id', requirePermission(PERMISSIONS.PURCHASES_DELETE), deletePurchase);

export default router;
