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
import { requireAuth, requirePermission } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { PERMISSIONS, hasPermission } from '../utils/permissions.js';

const router = Router();

// All invoice routes require authentication
router.use(requireAuth);

// Helper for invoice read access (Customers can read own invoices; staff require 'invoices:view')
function requireInvoiceRead(req, res, next) {
  if (req.user.role === 'customer' || hasPermission(req.user, PERMISSIONS.INVOICES_VIEW)) {
    return next();
  }
  return res.status(403).json({
    status: 'error',
    code: 'FORBIDDEN',
    message: "Forbidden: Missing required permission 'invoices:view'.",
  });
}

// Read routes: Accessible to Admin, authorized Accountant, and Customer (scoped to own account)
router.get('/', requireInvoiceRead, listInvoices);
router.get('/:id', requireInvoiceRead, getInvoiceById);

// Financial operations: Granularly authorized
router.post('/', requirePermission(PERMISSIONS.INVOICES_CREATE), validateBody(createInvoiceSchema), createInvoice);
router.put('/:id', requirePermission(PERMISSIONS.INVOICES_EDIT), validateBody(updateInvoiceSchema), updateInvoice);
router.post('/:id/finalize', requirePermission(PERMISSIONS.INVOICES_FINALIZE), finalizeInvoice);
router.post('/:id/void', requirePermission(PERMISSIONS.INVOICES_VOID), validateBody(voidInvoiceSchema), voidInvoice);

// Deletion: Restricted to users with invoices:delete permission (Draft invoices only)
router.delete('/:id', requirePermission(PERMISSIONS.INVOICES_DELETE), deleteInvoice);

export default router;
