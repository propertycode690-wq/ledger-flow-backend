import { Router } from 'express';
import {
  listVans,
  getVanById,
  createVan,
  updateVan,
  deleteVan,
  createVanSchema,
  updateVanSchema,
} from '../controllers/van.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Read routes: Admin, Accountant, and Customer can view delivery routes
router.get('/', listVans);
router.get('/:id', getVanById);

// Write routes: Admin only
router.post('/', requireRole(['admin']), validateBody(createVanSchema), createVan);
router.put('/:id', requireRole(['admin']), validateBody(updateVanSchema), updateVan);
router.delete('/:id', requireRole(['admin']), deleteVan);

export default router;
