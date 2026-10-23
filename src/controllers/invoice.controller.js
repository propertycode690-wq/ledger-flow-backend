import { z } from 'zod';
import prisma from '../config/db.js';
import { calculateInvoiceTotals, calculateLineItemTotals, round2 } from '../utils/money.js';
import { getNextInvoiceNumber } from '../utils/sequence.js';

const invoiceItemSchema = z.object({
  productId: z.string().trim().max(50).optional().nullable(),
  description: z.string().trim().min(1, 'Item description is required.').max(255),
  quantity: z.coerce.number().positive('Quantity must be greater than zero.'),
  unit: z.string().trim().min(1).max(50).default('kg'),
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative.'),
  vatRate: z.coerce.number().min(0, 'VAT rate cannot be negative.').max(100).default(0),
});

export const createInvoiceSchema = z.object({
  customerId: z.string().trim().min(1, 'Customer ID is required.').max(50),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'issueDate must be in YYYY-MM-DD format.').optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be in YYYY-MM-DD format.').optional(),
  reference: z.string().trim().max(100).optional().nullable(),
  status: z.enum(['Draft', 'Sent', 'Issued']).default('Sent'),
  discountAmount: z.coerce.number().min(0, 'Discount amount cannot be negative.').default(0),
  notes: z.string().trim().optional().nullable(),
  items: z.array(invoiceItemSchema).min(1, 'Invoice must have at least one line item.'),
});

export const updateInvoiceSchema = z.object({
  customerId: z.string().trim().min(1).max(50).optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reference: z.string().trim().max(100).optional().nullable(),
  discountAmount: z.coerce.number().min(0).optional(),
  notes: z.string().trim().optional().nullable(),
  items: z.array(invoiceItemSchema).min(1).optional(),
});

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(3, 'A valid reason for voiding this invoice is required.').max(255),
});

/**
 * @route   GET /api/v1/invoices
 * @desc    List invoices with pagination, search, status, customer and date filters
 * @access  Protected (Admin, Accountant, Customer)
 */
export async function listInvoices(req, res) {
  try {
    const {
      page = 1,
      limit = 25,
      search,
      status,
      customerId,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    // Strict customer isolation:
    // Customer users can ONLY see their own invoices
    if (req.user.role === 'customer') {
      where.customerId = req.user.customerId;
      // Hide drafts from customer portal view
      where.status = { not: 'Draft' };
    } else if (customerId) {
      where.customerId = customerId;
    }

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.issueDate = {};
      if (startDate) where.issueDate.gte = new Date(startDate);
      if (endDate) where.issueDate.lte = new Date(endDate);
    }

    if (search) {
      const term = search.trim();
      where.OR = [
        { invoiceNumber: { contains: term } },
        { reference: { contains: term } },
        { customer: { name: { contains: term } } },
      ];
    }

    const [total, invoices] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        skip,
        take: limitNum,
        include: {
          customer: {
            select: { id: true, name: true, contactPerson: true, email: true, phone: true },
          },
          _count: {
            select: { items: true },
          },
        },
        orderBy: { [sortBy]: sortOrder.toLowerCase() === 'asc' ? 'asc' : 'desc' },
      }),
    ]);

    return res.status(200).json({
      status: 'ok',
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
      data: invoices,
    });
  } catch (error) {
    console.error('List invoices error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve invoices.',
    });
  }
}

/**
 * @route   GET /api/v1/invoices/:id
 * @desc    Get detailed invoice with customer and line items
 * @access  Protected (Admin, Accountant, Customer)
 */
export async function getInvoiceById(req, res) {
  try {
    const { id } = req.params;

    const invoice = await prisma.invoice.findFirst({
      where: {
        OR: [{ id }, { invoiceNumber: id }],
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
            vatNumber: true,
            paymentTerms: true,
            van: { select: { id: true, name: true } },
          },
        },
        items: {
          include: {
            product: { select: { id: true, name: true, category: true, unit: true } },
          },
        },
        allocations: {
          include: {
            payment: {
              select: {
                id: true,
                paymentNumber: true,
                paymentDate: true,
                paymentMethod: true,
                reference: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!invoice) {
      return res.status(404).json({
        status: 'error',
        code: 'INVOICE_NOT_FOUND',
        message: `Invoice '${id}' was not found.`,
      });
    }

    // Customer isolation check
    if (req.user.role === 'customer' && invoice.customerId !== req.user.customerId) {
      return res.status(403).json({
        status: 'error',
        code: 'CUSTOMER_ISOLATION_VIOLATION',
        message: 'Forbidden: You do not have permission to view other customer invoices.',
      });
    }

    return res.status(200).json({
      status: 'ok',
      data: invoice,
    });
  } catch (error) {
    console.error('Get invoice error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve invoice.',
    });
  }
}

/**
 * @route   POST /api/v1/invoices
 * @desc    Create a new invoice with atomic sequential numbering and decimal calculation
 * @access  Protected (Admin, Accountant)
 */
export async function createInvoice(req, res) {
  try {
    const data = req.validatedBody;

    // Verify customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
    });

    if (!customer) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_CUSTOMER_ID',
        message: `Customer with ID '${data.customerId}' does not exist.`,
      });
    }

    // Verify product IDs if provided
    for (const item of data.items) {
      if (item.productId) {
        const prod = await prisma.product.findUnique({
          where: { id: item.productId },
        });
        if (!prod) {
          return res.status(400).json({
            status: 'error',
            code: 'INVALID_PRODUCT_ID',
            message: `Product with ID '${item.productId}' does not exist.`,
          });
        }
      }
    }

    // Calculate invoice totals server-side
    const calculatedTotals = calculateInvoiceTotals(data.items, data.discountAmount, 0);

    const issueDate = data.issueDate ? new Date(data.issueDate) : new Date();
    let dueDate;
    if (data.dueDate) {
      dueDate = new Date(data.dueDate);
    } else {
      const terms = customer.paymentTerms || 14;
      dueDate = new Date(issueDate.getTime() + terms * 24 * 60 * 60 * 1000);
    }

    // Create inside transaction to guarantee atomic sequential numbering
    const newInvoice = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await getNextInvoiceNumber(tx, issueDate.getFullYear());

      const created = await tx.invoice.create({
        data: {
          invoiceNumber,
          customerId: data.customerId,
          issueDate,
          dueDate,
          reference: data.reference || null,
          status: data.status,
          subtotal: calculatedTotals.subtotal,
          vatAmount: calculatedTotals.vatAmount,
          discountAmount: calculatedTotals.discountAmount,
          total: calculatedTotals.total,
          amountPaid: 0.00,
          balanceDue: data.status === 'Draft' ? 0.00 : calculatedTotals.total,
          notes: data.notes || null,
          items: {
            create: data.items.map((item) => {
              const line = calculateLineItemTotals(item.quantity, item.unitPrice, item.vatRate || 0);
              return {
                productId: item.productId || null,
                description: item.description,
                quantity: round2(item.quantity),
                unit: item.unit,
                unitPrice: round2(item.unitPrice),
                vatRate: round2(item.vatRate || 0),
                vatAmount: line.vatAmount,
                subtotal: line.subtotal,
                total: line.total,
              };
            }),
          },
        },
        include: {
          customer: {
            select: { id: true, name: true, email: true },
          },
          items: true,
        },
      });

      return created;
    });

    return res.status(201).json({
      status: 'ok',
      message: `Invoice '${newInvoice.invoiceNumber}' created successfully.`,
      data: newInvoice,
    });
  } catch (error) {
    console.error('Create invoice error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to create invoice.',
    });
  }
}

/**
 * @route   PUT /api/v1/invoices/:id
 * @desc    Update a draft invoice (finalized invoices are immutable)
 * @access  Protected (Admin, Accountant)
 */
export async function updateInvoice(req, res) {
  try {
    const { id } = req.params;
    const data = req.validatedBody;

    const existing = await prisma.invoice.findFirst({
      where: { OR: [{ id }, { invoiceNumber: id }] },
      include: { items: true },
    });

    if (!existing) {
      return res.status(404).json({
        status: 'error',
        code: 'INVOICE_NOT_FOUND',
        message: `Invoice '${id}' was not found.`,
      });
    }

    // Financial Safety Rule: Only Draft invoices can have their amounts or lines modified!
    if (existing.status !== 'Draft') {
      return res.status(409).json({
        status: 'error',
        code: 'CANNOT_EDIT_FINALIZED_INVOICE',
        message: `Cannot edit invoice '${existing.invoiceNumber}' because its status is '${existing.status}'. Finalized invoices are legally immutable. Use voiding or credit notes to correct issued invoices.`,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      let totals = {
        subtotal: existing.subtotal,
        vatAmount: existing.vatAmount,
        discountAmount: existing.discountAmount,
        total: existing.total,
        balanceDue: existing.balanceDue,
      };

      if (data.items) {
        // Delete old items and re-insert new items
        await tx.invoiceItem.deleteMany({
          where: { invoiceId: existing.id },
        });

        totals = calculateInvoiceTotals(data.items, data.discountAmount ?? existing.discountAmount, 0);

        await tx.invoiceItem.createMany({
          data: data.items.map((item) => {
            const line = calculateLineItemTotals(item.quantity, item.unitPrice, item.vatRate || 0);
            return {
              invoiceId: existing.id,
              productId: item.productId || null,
              description: item.description,
              quantity: round2(item.quantity),
              unit: item.unit,
              unitPrice: round2(item.unitPrice),
              vatRate: round2(item.vatRate || 0),
              vatAmount: line.vatAmount,
              subtotal: line.subtotal,
              total: line.total,
            };
          }),
        });
      }

      return tx.invoice.update({
        where: { id: existing.id },
        data: {
          reference: data.reference !== undefined ? data.reference : existing.reference,
          notes: data.notes !== undefined ? data.notes : existing.notes,
          issueDate: data.issueDate ? new Date(data.issueDate) : existing.issueDate,
          dueDate: data.dueDate ? new Date(data.dueDate) : existing.dueDate,
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          discountAmount: totals.discountAmount,
          total: totals.total,
          balanceDue: 0.00, // Draft balanceDue is 0 until finalized
        },
        include: {
          customer: { select: { id: true, name: true } },
          items: true,
        },
      });
    });

    return res.status(200).json({
      status: 'ok',
      message: `Draft invoice '${updated.invoiceNumber}' updated successfully.`,
      data: updated,
    });
  } catch (error) {
    console.error('Update invoice error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to update invoice.',
    });
  }
}

/**
 * @route   POST /api/v1/invoices/:id/finalize
 * @desc    Finalize a draft invoice into an active issued invoice
 * @access  Protected (Admin, Accountant)
 */
export async function finalizeInvoice(req, res) {
  try {
    const { id } = req.params;

    const invoice = await prisma.invoice.findFirst({
      where: { OR: [{ id }, { invoiceNumber: id }] },
    });

    if (!invoice) {
      return res.status(404).json({
        status: 'error',
        code: 'INVOICE_NOT_FOUND',
        message: `Invoice '${id}' was not found.`,
      });
    }

    if (invoice.status !== 'Draft') {
      return res.status(409).json({
        status: 'error',
        code: 'INVOICE_ALREADY_FINALIZED',
        message: `Invoice '${invoice.invoiceNumber}' is already in '${invoice.status}' status and cannot be finalized again.`,
      });
    }

    const finalized = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'Sent',
        balanceDue: invoice.total,
      },
      include: {
        customer: { select: { id: true, name: true } },
        items: true,
      },
    });

    return res.status(200).json({
      status: 'ok',
      message: `Invoice '${finalized.invoiceNumber}' finalized and issued successfully.`,
      data: finalized,
    });
  } catch (error) {
    console.error('Finalize invoice error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to finalize invoice.',
    });
  }
}

/**
 * @route   POST /api/v1/invoices/:id/void
 * @desc    Void an invoice with documented audit reason and safe payment allocation rollback
 * @access  Protected (Admin, Accountant)
 */
export async function voidInvoice(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.validatedBody;

    const invoice = await prisma.invoice.findFirst({
      where: { OR: [{ id }, { invoiceNumber: id }] },
      include: {
        allocations: {
          include: { payment: true },
        },
      },
    });

    if (!invoice) {
      return res.status(404).json({
        status: 'error',
        code: 'INVOICE_NOT_FOUND',
        message: `Invoice '${id}' was not found.`,
      });
    }

    if (invoice.status === 'Void') {
      return res.status(400).json({
        status: 'error',
        code: 'INVOICE_ALREADY_VOID',
        message: `Invoice '${invoice.invoiceNumber}' is already voided.`,
      });
    }

    const voided = await prisma.$transaction(async (tx) => {
      // If payments were allocated to this invoice, reverse the allocation
      // and return the amount to the customer's payment unallocated balance
      for (const alloc of invoice.allocations) {
        await tx.payment.update({
          where: { id: alloc.paymentId },
          data: {
            unallocatedAmount: { increment: alloc.amount },
          },
        });

        await tx.paymentAllocation.delete({
          where: { id: alloc.id },
        });
      }

      return tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'Void',
          amountPaid: 0.00,
          balanceDue: 0.00,
          voidReason: reason,
          voidedAt: new Date(),
        },
        include: {
          customer: { select: { id: true, name: true } },
        },
      });
    });

    return res.status(200).json({
      status: 'ok',
      message: `Invoice '${voided.invoiceNumber}' successfully voided.`,
      data: voided,
    });
  } catch (error) {
    console.error('Void invoice error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to void invoice.',
    });
  }
}

/**
 * @route   DELETE /api/v1/invoices/:id
 * @desc    Safely delete draft invoice only (issued invoices must be voided)
 * @access  Protected (Admin only)
 */
export async function deleteInvoice(req, res) {
  try {
    const { id } = req.params;

    const invoice = await prisma.invoice.findFirst({
      where: { OR: [{ id }, { invoiceNumber: id }] },
      include: {
        _count: { select: { allocations: true } },
      },
    });

    if (!invoice) {
      return res.status(404).json({
        status: 'error',
        code: 'INVOICE_NOT_FOUND',
        message: `Invoice '${id}' was not found.`,
      });
    }

    // Safety Policy: Only Draft invoices with 0 payments can be permanently removed
    if (invoice.status !== 'Draft') {
      return res.status(409).json({
        status: 'error',
        code: 'CANNOT_DELETE_FINALIZED_INVOICE',
        message: `Cannot delete invoice '${invoice.invoiceNumber}' with status '${invoice.status}'. Issued or historical financial records must be cancelled using the void API (POST /api/v1/invoices/:id/void) to preserve audit trails.`,
      });
    }

    if (invoice._count.allocations > 0) {
      return res.status(409).json({
        status: 'error',
        code: 'INVOICE_HAS_ALLOCATIONS',
        message: `Cannot delete draft invoice with payment allocations.`,
      });
    }

    await prisma.invoice.delete({
      where: { id: invoice.id },
    });

    return res.status(200).json({
      status: 'ok',
      message: `Draft invoice '${invoice.invoiceNumber}' deleted successfully.`,
    });
  } catch (error) {
    console.error('Delete invoice error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to delete invoice.',
    });
  }
}
