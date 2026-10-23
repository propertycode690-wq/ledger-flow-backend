import { Router } from 'express';
import { listAuditLogs } from '../controllers/auditLog.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(requireAuth);
router.get('/', requireRole(['admin', 'accountant']), listAuditLogs);

export default router;
