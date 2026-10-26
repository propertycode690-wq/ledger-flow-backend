import { Router } from 'express';
import {
  getVatReturn,
  listVatReturns,
  saveVatReturn,
  getProfitAndLoss,
  getAgedDebtors,
  saveVatReturnSchema,
} from '../controllers/report.controller.js';
import { requireAuth, requirePermission } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../utils/permissions.js';

const router = Router();

router.use(requireAuth);

router.get('/vat-return', requirePermission(PERMISSIONS.REPORTS_VAT), getVatReturn);
router.get('/vat-returns', requirePermission(PERMISSIONS.REPORTS_VAT), listVatReturns);
router.post('/vat-returns', requirePermission(PERMISSIONS.REPORTS_VAT), validateBody(saveVatReturnSchema), saveVatReturn);
router.get('/pnl', requirePermission(PERMISSIONS.REPORTS_PNL), getProfitAndLoss);
router.get('/aged-debtors', requirePermission(PERMISSIONS.REPORTS_VIEW), getAgedDebtors);

export default router;
