import { Router } from 'express';
import {
  getVatReturn,
  listVatReturns,
  saveVatReturn,
  getProfitAndLoss,
  getAgedDebtors,
  saveVatReturnSchema,
} from '../controllers/report.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

const router = Router();

router.use(requireAuth);

router.get('/vat-return', requireRole(['admin', 'accountant']), getVatReturn);
router.get('/vat-returns', requireRole(['admin', 'accountant']), listVatReturns);
router.post('/vat-returns', requireRole(['admin', 'accountant']), validateBody(saveVatReturnSchema), saveVatReturn);
router.get('/pnl', requireRole(['admin', 'accountant']), getProfitAndLoss);
router.get('/aged-debtors', requireRole(['admin', 'accountant']), getAgedDebtors);

export default router;
