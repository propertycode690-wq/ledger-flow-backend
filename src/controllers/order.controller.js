import { z } from 'zod';
import prisma from '../config/db.js';
import { getNextOrderNumber } from '../utils/sequence.js';
import { round2 } from '../utils/money.js';

export const orderItemSchema = z.object({
  productId: z.string().trim().max(50).optional().nullable(),
  name: z.string().trim().min(1, 'Product or item name is required.').max(255),
  quantity: z.coerce.number().positive('Quantity must be greater than zero.'),
  unit: z.string().trim().min(1).max(50).default('kg'),
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative.').optional().nullable(),
});

export const createOrderSchema = z.object({
  customerId: z.string().trim().min(1, 'Customer ID is required.').max(50),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'orderDate must be in YYYY-MM-DD format.').optional(),
  vanId: z.string().trim().max(50).optional().nullable(),
  status: z.enum(['Confirmed', 'Draft', 'Invoiced', 'Cancelled']).default('Confirmed'),
  notes: z.string().trim().optional().nullable(),
  items: z.array(orderItemSchema).min(1, 'Order must contain at least one product item.'),
});

export const updateOrderSchema = z.object({
  customerId: z.string().trim().min(1).max(50).optional(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'orderDate must be in YYYY-MM-DD format.').optional(),
  vanId: z.string().trim().max(50).optional().nullable(),
  status: z.enum(['Confirmed', 'Draft', 'Invoiced', 'Cancelled']).optional(),
  notes: z.string().trim().optional().nullable(),
  items: z.array(orderItemSchema).min(1).optional(),
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(255).optional().nullable(),
});

/**
 * @route   GET /api/v1/orders
 * @desc    List daily customer orders with pagination, search, status, customer and van filters
 * @access  Protected (Admin, Accountant, Customer)
 */
export async function listOrders(req, res) {
  try {
    const {
      page = 1,
      limit = 25,
      search,
      status,
      customerId,
      vanId,
      date,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    // Customer role isolation
    if (req.user.role === 'customer') {
      where.customerId = req.user.customerId;
    } else if (customerId) {
      where.customerId = customerId;
    }

    // Filter by Van
    if (vanId) {
      if (vanId === 'unassigned') {
        where.vanId = null;
      } else {
        where.vanId = vanId;
      }
    }

    // Filter by Status
    if (status) {
      where.status = status;
    }

    // Date filtering: specific date or range
    if (date) {
      const targetDate = new Date(date);
      if (!isNaN(targetDate.getTime())) {
        where.orderDate = targetDate;
      }
    } else if (startDate || endDate) {
      where.orderDate = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) where.orderDate.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) where.orderDate.lte = end;
      }
    }

    // Search by orderNumber, customer name, notes, or item name
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { orderNumber: { contains: q } },
        { customer: { name: { contains: q } } },
        { notes: { contains: q } },
        { items: { some: { name: { contains: q } } } },
      ];
    }

    const allowedSortFields = ['createdAt', 'orderDate', 'orderNumber', 'status'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortDir = sortOrder.toLowerCase() === 'asc' ? 'asc' : 'desc';

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { [sortField]: sortDir },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              contactPerson: true,
              email: true,
              vanId: true,
            },
          },
          van: {
            select: {
              id: true,
              name: true,
              vehicle: true,
            },
          },
          items: {
            select: {
              id: true,
              productId: true,
              name: true,
              quantity: true,
              unit: true,
              unitPrice: true,
            },
          },
        },
      }),
      prisma.order.count({ where }),
    ]);

    const formatted = orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerId: o.customerId,
      customerName: o.customer?.name || 'Unknown',
      vanId: o.vanId,
      vanName: o.van?.name || 'Unassigned',
      orderDate: o.orderDate.toISOString().split('T')[0],
      status: o.status,
      notes: o.notes,
      itemCount: o.items.length,
      items: o.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        name: i.name,
        quantity: parseFloat(i.quantity.toString()),
        unit: i.unit,
        unitPrice: i.unitPrice !== null ? parseFloat(i.unitPrice.toString()) : null,
      })),
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));

    return res.status(200).json({
      status: 'success',
      data: {
        orders: formatted,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      },
    });
  } catch (error) {
    console.error('listOrders error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve orders.',
    });
  }
}

/**
 * @route   GET /api/v1/orders/:id
 * @desc    Retrieve order details with line items
 * @access  Protected (Admin, Accountant, Customer)
 */
export async function getOrderById(req, res) {
  try {
    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: {
        OR: [{ id }, { orderNumber: id }],
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            contactPerson: true,
            email: true,
            phone: true,
            address: true,
            vanId: true,
          },
        },
        van: {
          select: {
            id: true,
            name: true,
            vehicle: true,
          },
        },
        items: {
          select: {
            id: true,
            productId: true,
            name: true,
            quantity: true,
            unit: true,
            unitPrice: true,
            createdAt: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({
        status: 'error',
        code: 'ORDER_NOT_FOUND',
        message: `Order '${id}' not found.`,
      });
    }

    // Customer role isolation
    if (req.user.role === 'customer' && order.customerId !== req.user.customerId) {
      return res.status(403).json({
        status: 'error',
        code: 'CUSTOMER_ISOLATION_VIOLATION',
        message: 'Forbidden: You cannot access orders belonging to another customer.',
      });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        id: order.id,
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        customerName: order.customer?.name || 'Unknown',
        customer: order.customer,
        vanId: order.vanId,
        van: order.van,
        orderDate: order.orderDate.toISOString().split('T')[0],
        status: order.status,
        notes: order.notes,
        items: order.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          name: i.name,
          quantity: parseFloat(i.quantity.toString()),
          unit: i.unit,
          unitPrice: i.unitPrice !== null ? parseFloat(i.unitPrice.toString()) : null,
          createdAt: i.createdAt,
        })),
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
    });
  } catch (error) {
    console.error('getOrderById error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve order details.',
    });
  }
}

/**
 * @route   POST /api/v1/orders
 * @desc    Create a new daily customer order with multiple items
 * @access  Protected (Admin, Accountant only)
 */
export async function createOrder(req, res) {
  try {
    // Explicit safety check: reject customer role self-service
    if (req.user.role === 'customer') {
      return res.status(403).json({
        status: 'error',
        code: 'SELF_SERVICE_ORDERING_NOT_PERMITTED',
        message: 'Forbidden: Customer self-service order creation is not permitted. Orders must be submitted by an administrator or accountant.',
      });
    }

    const {
      customerId,
      orderDate,
      vanId,
      status = 'Confirmed',
      notes,
      items,
    } = req.validatedBody || req.body;

    const dateStr = orderDate || new Date().toISOString().split('T')[0];
    const targetDate = new Date(dateStr);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_DATE',
        message: 'Invalid orderDate provided.',
      });
    }

    // 1. Validate Customer existence and status
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, name: true, vanId: true, status: true },
    });

    if (!customer) {
      return res.status(404).json({
        status: 'error',
        code: 'CUSTOMER_NOT_FOUND',
        message: `Customer '${customerId}' does not exist.`,
      });
    }

    if (customer.status === 'Inactive') {
      return res.status(400).json({
        status: 'error',
        code: 'CUSTOMER_INACTIVE',
        message: `Cannot place an order for inactive customer '${customer.name}'.`,
      });
    }

    // 2. Validate Van assignment
    // If vanId not supplied in body, default to customer's assigned van
    const resolvedVanId = vanId !== undefined ? (vanId || null) : (customer.vanId || null);
    if (resolvedVanId) {
      const van = await prisma.van.findUnique({
        where: { id: resolvedVanId },
        select: { id: true, isActive: true },
      });
      if (!van) {
        return res.status(404).json({
          status: 'error',
          code: 'VAN_NOT_FOUND',
          message: `Van '${resolvedVanId}' does not exist.`,
        });
      }
      if (!van.isActive) {
        return res.status(400).json({
          status: 'error',
          code: 'VAN_INACTIVE',
          message: `Van '${resolvedVanId}' is currently inactive.`,
        });
      }
    }

    // 3. Validate Products and resolve snapshots
    const productIds = items
      .map((i) => i.productId)
      .filter((pid) => pid && typeof pid === 'string');

    let productsMap = new Map();
    if (productIds.length > 0) {
      const dbProducts = await prisma.product.findMany({
        where: { id: { in: productIds } },
      });
      productsMap = new Map(dbProducts.map((p) => [p.id, p]));

      // Verify all specified products exist and are active
      for (const pid of productIds) {
        const prod = productsMap.get(pid);
        if (!prod) {
          return res.status(404).json({
            status: 'error',
            code: 'PRODUCT_NOT_FOUND',
            message: `Product '${pid}' does not exist.`,
          });
        }
        if (!prod.isActive) {
          return res.status(400).json({
            status: 'error',
            code: 'PRODUCT_INACTIVE',
            message: `Product '${prod.name}' (${pid}) is deactivated.`,
          });
        }
      }
    }

    // 4. Create Order within Transaction
    const newOrder = await prisma.$transaction(async (tx) => {
      const orderNumber = await getNextOrderNumber(tx, dateStr);

      const created = await tx.order.create({
        data: {
          orderNumber,
          customerId,
          vanId: resolvedVanId,
          orderDate: targetDate,
          status,
          notes: notes || null,
          items: {
            create: items.map((item) => {
              const matchedProduct = item.productId ? productsMap.get(item.productId) : null;
              return {
                productId: item.productId || null,
                name: item.name || matchedProduct?.name || 'Item',
                quantity: item.quantity,
                unit: item.unit || matchedProduct?.unit || 'kg',
                unitPrice: item.unitPrice !== undefined && item.unitPrice !== null ? item.unitPrice : (matchedProduct ? parseFloat(matchedProduct.defaultRate.toString()) : null),
              };
            }),
          },
        },
        include: {
          customer: { select: { id: true, name: true, vanId: true } },
          van: { select: { id: true, name: true, vehicle: true } },
          items: true,
        },
      });

      return created;
    });

    return res.status(201).json({
      status: 'success',
      message: `Order ${newOrder.orderNumber} created successfully.`,
      data: {
        id: newOrder.id,
        orderNumber: newOrder.orderNumber,
        customerId: newOrder.customerId,
        customerName: newOrder.customer?.name,
        vanId: newOrder.vanId,
        vanName: newOrder.van?.name || 'Unassigned',
        orderDate: newOrder.orderDate.toISOString().split('T')[0],
        status: newOrder.status,
        notes: newOrder.notes,
        items: newOrder.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          name: i.name,
          quantity: parseFloat(i.quantity.toString()),
          unit: i.unit,
          unitPrice: i.unitPrice !== null ? parseFloat(i.unitPrice.toString()) : null,
        })),
        createdAt: newOrder.createdAt,
      },
    });
  } catch (error) {
    console.error('createOrder error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to create daily order.',
    });
  }
}

/**
 * @route   PUT /api/v1/orders/:id
 * @desc    Update order details and items according to lifecycle rules
 * @access  Protected (Admin, Accountant only)
 */
export async function updateOrder(req, res) {
  try {
    const { id } = req.params;
    const body = req.validatedBody || req.body;

    const existingOrder = await prisma.order.findFirst({
      where: { OR: [{ id }, { orderNumber: id }] },
      include: { items: true },
    });

    if (!existingOrder) {
      return res.status(404).json({
        status: 'error',
        code: 'ORDER_NOT_FOUND',
        message: `Order '${id}' not found.`,
      });
    }

    // Documented Lifecycle constraints
    if (existingOrder.status === 'Cancelled') {
      return res.status(400).json({
        status: 'error',
        code: 'ORDER_LIFECYCLE_VIOLATION',
        message: 'Cannot edit an order that has already been cancelled.',
      });
    }

    if (existingOrder.status === 'Invoiced') {
      return res.status(400).json({
        status: 'error',
        code: 'ORDER_LIFECYCLE_VIOLATION',
        message: 'Cannot edit an order that has already been invoiced.',
      });
    }

    // Validate customer if changing
    if (body.customerId && body.customerId !== existingOrder.customerId) {
      const cust = await prisma.customer.findUnique({
        where: { id: body.customerId },
      });
      if (!cust) {
        return res.status(404).json({
          status: 'error',
          code: 'CUSTOMER_NOT_FOUND',
          message: `Customer '${body.customerId}' not found.`,
        });
      }
      if (cust.status === 'Inactive') {
        return res.status(400).json({
          status: 'error',
          code: 'CUSTOMER_INACTIVE',
          message: 'Cannot transfer order to an inactive customer.',
        });
      }
    }

    // Validate van if changing
    if (body.vanId !== undefined && body.vanId !== null) {
      const van = await prisma.van.findUnique({
        where: { id: body.vanId },
      });
      if (!van) {
        return res.status(404).json({
          status: 'error',
          code: 'VAN_NOT_FOUND',
          message: `Van '${body.vanId}' not found.`,
        });
      }
    }

    // Validate products if items are updated
    let productsMap = new Map();
    if (body.items && Array.isArray(body.items)) {
      const pids = body.items.map((i) => i.productId).filter(Boolean);
      if (pids.length > 0) {
        const dbProducts = await prisma.product.findMany({
          where: { id: { in: pids } },
        });
        productsMap = new Map(dbProducts.map((p) => [p.id, p]));
        for (const pid of pids) {
          const prod = productsMap.get(pid);
          if (!prod) {
            return res.status(404).json({
              status: 'error',
              code: 'PRODUCT_NOT_FOUND',
              message: `Product '${pid}' not found.`,
            });
          }
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updateData = {};
      if (body.customerId) updateData.customerId = body.customerId;
      if (body.vanId !== undefined) updateData.vanId = body.vanId || null;
      if (body.status) updateData.status = body.status;
      if (body.notes !== undefined) updateData.notes = body.notes;
      if (body.orderDate) {
        const targetDate = new Date(body.orderDate);
        if (!isNaN(targetDate.getTime())) {
          updateData.orderDate = targetDate;
        }
      }

      // If items provided, replace existing items
      if (body.items && Array.isArray(body.items)) {
        await tx.orderItem.deleteMany({
          where: { orderId: existingOrder.id },
        });

        updateData.items = {
          create: body.items.map((item) => {
            const matchedProduct = item.productId ? productsMap.get(item.productId) : null;
            return {
              productId: item.productId || null,
              name: item.name || matchedProduct?.name || 'Item',
              quantity: item.quantity,
              unit: item.unit || matchedProduct?.unit || 'kg',
              unitPrice: item.unitPrice !== undefined && item.unitPrice !== null ? item.unitPrice : (matchedProduct ? parseFloat(matchedProduct.defaultRate.toString()) : null),
            };
          }),
        };
      }

      return tx.order.update({
        where: { id: existingOrder.id },
        data: updateData,
        include: {
          customer: { select: { id: true, name: true, vanId: true } },
          van: { select: { id: true, name: true, vehicle: true } },
          items: true,
        },
      });
    });

    return res.status(200).json({
      status: 'success',
      message: `Order ${updated.orderNumber} updated successfully.`,
      data: {
        id: updated.id,
        orderNumber: updated.orderNumber,
        customerId: updated.customerId,
        customerName: updated.customer?.name,
        vanId: updated.vanId,
        vanName: updated.van?.name || 'Unassigned',
        orderDate: updated.orderDate.toISOString().split('T')[0],
        status: updated.status,
        notes: updated.notes,
        items: updated.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          name: i.name,
          quantity: parseFloat(i.quantity.toString()),
          unit: i.unit,
          unitPrice: i.unitPrice !== null ? parseFloat(i.unitPrice.toString()) : null,
        })),
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error('updateOrder error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to update order.',
    });
  }
}

/**
 * @route   POST /api/v1/orders/:id/cancel
 * @desc    Cancel an order according to lifecycle rules
 * @access  Protected (Admin, Accountant only)
 */
export async function cancelOrder(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const order = await prisma.order.findFirst({
      where: { OR: [{ id }, { orderNumber: id }] },
    });

    if (!order) {
      return res.status(404).json({
        status: 'error',
        code: 'ORDER_NOT_FOUND',
        message: `Order '${id}' not found.`,
      });
    }

    if (order.status === 'Cancelled') {
      return res.status(400).json({
        status: 'error',
        code: 'ORDER_ALREADY_CANCELLED',
        message: 'Order is already cancelled.',
      });
    }

    if (order.status === 'Invoiced') {
      return res.status(400).json({
        status: 'error',
        code: 'ORDER_ALREADY_INVOICED',
        message: 'Cannot cancel an order that has already been converted to an invoice.',
      });
    }

    const updatedNotes = reason
      ? (order.notes ? `${order.notes}\n[Cancelled: ${reason}]` : `[Cancelled: ${reason}]`)
      : order.notes;

    const cancelled = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'Cancelled',
        notes: updatedNotes,
      },
      include: {
        customer: { select: { id: true, name: true } },
      },
    });

    return res.status(200).json({
      status: 'success',
      message: `Order ${cancelled.orderNumber} has been cancelled.`,
      data: {
        id: cancelled.id,
        orderNumber: cancelled.orderNumber,
        status: cancelled.status,
        notes: cancelled.notes,
        updatedAt: cancelled.updatedAt,
      },
    });
  } catch (error) {
    console.error('cancelOrder error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to cancel order.',
    });
  }
}

/**
 * @route   DELETE /api/v1/orders/:id
 * @desc    Safely delete an unconfirmed Draft or Cancelled order
 * @access  Protected (Admin only)
 */
export async function deleteOrder(req, res) {
  try {
    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: { OR: [{ id }, { orderNumber: id }] },
    });

    if (!order) {
      return res.status(404).json({
        status: 'error',
        code: 'ORDER_NOT_FOUND',
        message: `Order '${id}' not found.`,
      });
    }

    // Active orders cannot be deleted silently
    if (order.status === 'Confirmed' || order.status === 'Invoiced') {
      return res.status(400).json({
        status: 'error',
        code: 'ACTIVE_ORDER_DELETION_FORBIDDEN',
        message: `Cannot delete active '${order.status}' order. Please cancel the order instead to preserve operational audit logs.`,
      });
    }

    await prisma.order.delete({
      where: { id: order.id },
    });

    return res.status(200).json({
      status: 'success',
      message: `Order ${order.orderNumber} has been permanently deleted.`,
    });
  } catch (error) {
    console.error('deleteOrder error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to delete order.',
    });
  }
}

/**
 * @route   GET /api/v1/orders/procurement/aggregation
 * @desc    Calculate daily wholesale purchasing requirements grouped by product and order date
 *          with van breakdowns and unassigned-van order tracking
 * @access  Protected (Admin, Accountant)
 */
export async function getProcurementAggregation(req, res) {
  try {
    const { date, vanId } = req.query;

    const targetDateStr = date || new Date().toISOString().split('T')[0];
    const targetDate = new Date(targetDateStr);

    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_DATE',
        message: 'Query parameter date must be in YYYY-MM-DD format.',
      });
    }

    const where = {
      orderDate: targetDate,
      // Strictly exclude Cancelled and Draft orders from wholesale procurement commitments
      status: { in: ['Confirmed', 'Invoiced'] },
    };

    if (vanId) {
      if (vanId === 'unassigned') {
        where.vanId = null;
      } else {
        where.vanId = vanId;
      }
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            vanId: true,
          },
        },
        van: {
          select: {
            id: true,
            name: true,
          },
        },
        items: true,
      },
      orderBy: { orderNumber: 'asc' },
    });

    // Derive procurement breakdown dynamically from order items
    // Key: `${productId || ''}__${name.trim().toLowerCase()}__${unit.trim().toLowerCase()}`
    const productAggregationMap = new Map();
    let unassignedOrdersCount = 0;
    const unassignedOrderNumbers = [];
    const statusCounts = {};

    for (const order of orders) {
      statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;

      const orderVanKey = order.vanId || 'unassigned';
      if (!order.vanId) {
        unassignedOrdersCount += 1;
        unassignedOrderNumbers.push(order.orderNumber);
      }

      for (const item of order.items) {
        const nameClean = item.name.trim();
        const unitClean = item.unit.trim();
        const aggKey = `${item.productId || 'custom'}__${nameClean.toLowerCase()}__${unitClean.toLowerCase()}`;

        const qty = parseFloat(item.quantity.toString());

        if (!productAggregationMap.has(aggKey)) {
          productAggregationMap.set(aggKey, {
            productId: item.productId || null,
            name: nameClean,
            unit: unitClean,
            totalQuantity: 0,
            vanBreakdown: {},
            customerBreakdown: [],
          });
        }

        const agg = productAggregationMap.get(aggKey);
        agg.totalQuantity = round2(agg.totalQuantity + qty);

        // Track breakdown by van
        agg.vanBreakdown[orderVanKey] = round2((agg.vanBreakdown[orderVanKey] || 0) + qty);

        // Track customer detail breakdown
        agg.customerBreakdown.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerId: order.customerId,
          customerName: order.customer?.name || 'Unknown',
          vanId: order.vanId,
          vanName: order.van?.name || 'Unassigned',
          quantity: qty,
        });
      }
    }

    // Convert map to sorted array by product name
    const procurementList = Array.from(productAggregationMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return res.status(200).json({
      status: 'success',
      data: {
        date: targetDateStr,
        filterVanId: vanId || 'all',
        totalOrders: orders.length,
        ordersByStatus: statusCounts,
        unassignedOrdersCount,
        unassignedOrderNumbers,
        totalProducts: procurementList.length,
        procurementList,
      },
    });
  } catch (error) {
    console.error('getProcurementAggregation error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to calculate procurement aggregation.',
    });
  }
}

export const updateFulfillmentSchema = z.object({
  date: z.string().trim().min(1, 'Date is required.'),
  fulfillments: z.array(
    z.object({
      productName: z.string().trim().min(1),
      purchasedQty: z.number().min(0),
      isCompleted: z.boolean().optional(),
    })
  ).min(1, 'At least one fulfillment record is required.'),
});

/**
 * @route   GET /api/v1/orders/procurement/fulfillment
 * @desc    Get persisted market fulfillment quantities and status for a specific date
 * @access  Protected (Admin, Accountant)
 */
export async function getProcurementFulfillment(req, res) {
  try {
    const { date } = req.query;
    const targetDateStr = date || new Date().toISOString().split('T')[0];
    const targetDate = new Date(targetDateStr);

    const records = await prisma.procurementFulfillment.findMany({
      where: { date: targetDate },
    });

    const fulfillmentMap = {};
    records.forEach((r) => {
      fulfillmentMap[r.productName] = {
        purchasedQty: parseFloat(r.purchasedQty.toString()) || 0,
        isCompleted: r.isCompleted,
      };
    });

    return res.status(200).json({
      status: 'success',
      data: {
        date: targetDateStr,
        fulfillment: fulfillmentMap,
      },
    });
  } catch (error) {
    console.error('getProcurementFulfillment error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve procurement fulfillment.',
    });
  }
}

/**
 * @route   PUT /api/v1/orders/procurement/fulfillment
 * @desc    Persist market fulfillment quantities and status to MySQL
 * @access  Protected (Admin only)
 */
export async function updateProcurementFulfillment(req, res) {
  try {
    const { date, fulfillments } = req.validatedBody;
    const targetDate = new Date(date);

    await prisma.$transaction(async (tx) => {
      for (const item of fulfillments) {
        await tx.procurementFulfillment.upsert({
          where: {
            date_productName: {
              date: targetDate,
              productName: item.productName,
            },
          },
          create: {
            date: targetDate,
            productName: item.productName,
            purchasedQty: item.purchasedQty,
            isCompleted: item.isCompleted || false,
          },
          update: {
            purchasedQty: item.purchasedQty,
            ...(item.isCompleted !== undefined ? { isCompleted: item.isCompleted } : {}),
          },
        });
      }
    });

    return res.status(200).json({
      status: 'success',
      message: 'Procurement fulfillment saved to database.',
    });
  } catch (error) {
    console.error('updateProcurementFulfillment error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to update procurement fulfillment.',
    });
  }
}
