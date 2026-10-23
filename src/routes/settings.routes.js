import { Router } from 'express';
import {
  getSettings,
  updateSettings,
  updateSettingsSchema,
} from '../controllers/settings.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

const router = Router();

router.use(requireAuth);

router.get('/', requireRole(['admin', 'accountant']), getSettings);
router.put('/', requireRole(['admin']), validateBody(updateSettingsSchema), updateSettings);

export default router;
