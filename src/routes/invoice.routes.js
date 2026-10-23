import { Router } from 'express';
import {
  listInvoices,
  getInvoiceById,
  createInvoice,
  updateInvoice,
  finalizeInvoice,
  voidInvoice,
  deleteInvoice,
  createInvoiceSchema,
  updateInvoiceSchema,
  voidInvoiceSchema,
} from '../controllers/invoice.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

const router = Router();

// All invoice routes require authentication
router.use(requireAuth);

// Read routes: Accessible to Admin, Accountant, and Customer (scoped to own account)
router.get('/', listInvoices);
router.get('/:id', getInvoiceById);

// Financial operations: Restricted to Admin and Accountant
router.post('/', requireRole(['admin', 'accountant']), validateBody(createInvoiceSchema), createInvoice);
router.put('/:id', requireRole(['admin', 'accountant']), validateBody(updateInvoiceSchema), updateInvoice);
router.post('/:id/finalize', requireRole(['admin', 'accountant']), finalizeInvoice);
router.post('/:id/void', requireRole(['admin', 'accountant']), validateBody(voidInvoiceSchema), voidInvoice);

// Deletion: Restricted to Admin (Draft invoices only)
router.delete('/:id', requireRole(['admin']), deleteInvoice);

export default router;
