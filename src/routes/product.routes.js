import { Router } from 'express';
import {
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  createProductSchema,
  updateProductSchema,
} from '../controllers/product.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

const router = Router();

// All product routes require authentication
router.use(requireAuth);

// Read routes: Admin, Accountant, and Customer can view products catalog
router.get('/', listProducts);
router.get('/:id', getProductById);

// Write routes: Admin only
router.post('/', requireRole(['admin']), validateBody(createProductSchema), createProduct);
router.put('/:id', requireRole(['admin']), validateBody(updateProductSchema), updateProduct);
router.delete('/:id', requireRole(['admin']), deleteProduct);

export default router;
