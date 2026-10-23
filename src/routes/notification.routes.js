import { Router } from 'express';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  createNotification,
  createNotificationSchema,
} from '../controllers/notification.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

const router = Router();

router.use(requireAuth);

router.get('/', listNotifications);
router.put('/:id/read', markNotificationRead);
router.put('/read-all', markAllNotificationsRead);
router.post('/', requireRole(['admin']), validateBody(createNotificationSchema), createNotification);

export default router;
