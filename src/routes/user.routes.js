import { Router } from 'express';
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUserStatus,
  getCatalog,
  createUserSchema,
  updateUserSchema,
  toggleStatusSchema,
} from '../controllers/user.controller.js';
import { requireAuth, requireRole, requirePermission } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../utils/permissions.js';

const router = Router();

// All user management routes require valid authentication
router.use(requireAuth);

// Taxonomy / permission catalog endpoint: viewable by authenticated staff
router.get('/permissions/catalog', getCatalog);

// User administration routes: strictly restricted to Admin role with users:manage permission
router.get('/', requireRole(['admin']), requirePermission(PERMISSIONS.USERS_MANAGE), listUsers);
router.post('/', requireRole(['admin']), requirePermission(PERMISSIONS.USERS_MANAGE), validateBody(createUserSchema), createUser);
router.get('/:id', requireRole(['admin']), requirePermission(PERMISSIONS.USERS_MANAGE), getUserById);
router.put('/:id', requireRole(['admin']), requirePermission(PERMISSIONS.USERS_MANAGE), validateBody(updateUserSchema), updateUser);
router.patch('/:id/status', requireRole(['admin']), requirePermission(PERMISSIONS.USERS_MANAGE), validateBody(toggleStatusSchema), toggleUserStatus);

export default router;
