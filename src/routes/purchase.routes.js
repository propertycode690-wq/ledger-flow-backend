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
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

const router = Router();

// All purchases routes require authenticated Admin or Accountant
router.use(requireAuth);
router.use(requireRole(['admin', 'accountant']));

// Supplier catalog and batch migration routes (must precede /:id)
router.get('/suppliers', listSuppliers);
router.post('/import-preview', validateBody(batchImportSchema), previewBatchImport);
router.post('/import', requireRole(['admin']), validateBody(batchImportSchema), executeBatchImport);

// Purchase bills CRUD routes
router.get('/', listPurchases);
router.get('/:id', getPurchaseById);
router.post('/', validateBody(createPurchaseSchema), createPurchase);
router.put('/:id', validateBody(updatePurchaseSchema), updatePurchase);
router.delete('/:id', requireRole(['admin']), deletePurchase);

export default router;
