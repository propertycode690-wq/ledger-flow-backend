import { Router } from 'express';
import {
  listOrders,
  getOrderById,
  createOrder,
  updateOrder,
  cancelOrder,
  deleteOrder,
  getProcurementAggregation,
  getProcurementFulfillment,
  updateProcurementFulfillment,
  createOrderSchema,
  updateOrderSchema,
  cancelOrderSchema,
  updateFulfillmentSchema,
} from '../controllers/order.controller.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

const router = Router();

// All order endpoints require authentication
router.use(requireAuth);

// Read endpoints: Admin, Accountant, and Customer (Customer isolated to own orders)
router.get('/', listOrders);

// Wholesale procurement aggregation endpoint: Admin and Accountant only
router.get('/procurement/aggregation', requireRole(['admin', 'accountant']), getProcurementAggregation);

// Wholesale procurement fulfillment persistence: Admin and Accountant
router.get('/procurement/fulfillment', requireRole(['admin', 'accountant']), getProcurementFulfillment);
router.put('/procurement/fulfillment', requireRole(['admin']), validateBody(updateFulfillmentSchema), updateProcurementFulfillment);

// Order details: Admin, Accountant, and Customer
router.get('/:id', getOrderById);

// Order creation & lifecycle modifications: Admin and Accountant only
router.post('/', requireRole(['admin', 'accountant']), validateBody(createOrderSchema), createOrder);
router.put('/:id', requireRole(['admin', 'accountant']), validateBody(updateOrderSchema), updateOrder);
router.post('/:id/cancel', requireRole(['admin', 'accountant']), validateBody(cancelOrderSchema), cancelOrder);

// Safe deletion: Admin only (for Draft/Cancelled records)
router.delete('/:id', requireRole(['admin']), deleteOrder);

export default router;
