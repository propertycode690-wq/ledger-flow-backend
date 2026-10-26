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
import { requireAuth, requirePermission } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { PERMISSIONS, hasPermission } from '../utils/permissions.js';

const router = Router();

// All order endpoints require authentication
router.use(requireAuth);

function requireOrderRead(req, res, next) {
  if (req.user.role === 'customer' || hasPermission(req.user, PERMISSIONS.ORDERS_VIEW)) {
    return next();
  }
  return res.status(403).json({
    status: 'error',
    code: 'FORBIDDEN',
    message: "Forbidden: Missing required permission 'orders:view'.",
  });
}

// Read endpoints: Admin, permitted staff, and Customer (Customer isolated to own orders)
router.get('/', requireOrderRead, listOrders);

// Wholesale procurement aggregation endpoint: permitted staff only
router.get('/procurement/aggregation', requirePermission(PERMISSIONS.ORDERS_VIEW), getProcurementAggregation);

// Wholesale procurement fulfillment persistence: permitted staff
router.get('/procurement/fulfillment', requirePermission(PERMISSIONS.ORDERS_VIEW), getProcurementFulfillment);
router.put('/procurement/fulfillment', requirePermission(PERMISSIONS.ORDERS_EDIT), validateBody(updateFulfillmentSchema), updateProcurementFulfillment);

// Order details: Admin, permitted staff, and Customer
router.get('/:id', requireOrderRead, getOrderById);

// Order creation & lifecycle modifications: strictly authorized
router.post('/', requirePermission(PERMISSIONS.ORDERS_CREATE), validateBody(createOrderSchema), createOrder);
router.put('/:id', requirePermission(PERMISSIONS.ORDERS_EDIT), validateBody(updateOrderSchema), updateOrder);
router.post('/:id/cancel', requirePermission(PERMISSIONS.ORDERS_EDIT), validateBody(cancelOrderSchema), cancelOrder);

// Safe deletion: requires orders:delete
router.delete('/:id', requirePermission(PERMISSIONS.ORDERS_DELETE), deleteOrder);

export default router;
