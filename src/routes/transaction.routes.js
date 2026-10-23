import { Router } from 'express';
import {
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  importTransactionsBatch,
  createTransactionSchema,
  updateTransactionSchema,
  batchImportSchema,
} from '../controllers/transaction.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

const router = Router();

router.use(requireAuth);

router.get('/', requireRole(['admin', 'accountant']), listTransactions);
router.post('/', requireRole(['admin', 'accountant']), validateBody(createTransactionSchema), createTransaction);
router.post('/import-batch', requireRole(['admin']), validateBody(batchImportSchema), importTransactionsBatch);
router.put('/:id', requireRole(['admin', 'accountant']), validateBody(updateTransactionSchema), updateTransaction);
router.delete('/:id', requireRole(['admin']), deleteTransaction);

export default router;
