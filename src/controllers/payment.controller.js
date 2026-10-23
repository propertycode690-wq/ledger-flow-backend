import { z } from 'zod';
import prisma from '../config/db.js';
import { round2 } from '../utils/money.js';
import { getNextPaymentNumber } from '../utils/sequence.js';

const allocationItemSchema = z.object({
  invoiceId: z.string().trim().min(1, 'Invoice ID is required for allocation.'),
  amount: z.coerce.number().positive('Allocated amount must be greater than zero.'),
});

export const createPaymentSchema = z.object({
  customerId: z.string().trim().min(1, 'Customer ID is required.').max(50),
  amount: z.coerce.number().positive('Payment amount must be greater than zero.'),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'paymentDate must be in YYYY-MM-DD format.').optional(),
  paymentMethod: z.string().trim().min(1).max(50).default('Bank Transfer'),
  reference: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  idempotencyKey: z.string().trim().max(100).optional().nullable(),
  allocations: z.array(allocationItemSchema).optional().default([]),
});

export const voidPaymentSchema = z.object({
  reason: z.string().trim().min(3, 'A valid reason for voiding this payment is required.').max(255),
});

/**
 * @route   GET /api/v1/payments
 * @desc    List payments with pagination, customer filter, and date range
 * @access  Protected (Admin, Accountant, Customer)
 */
export async function listPayments(req, res) {
  try {
    const {
      page = 1,
      limit = 25,
      customerId,
      startDate,
      endDate,
      status,
      search,
      sortBy = 'paymentDate',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    // Customer isolation:
    if (req.user.role === 'customer') {
      where.customerId = req.user.customerId;
    } else if (customerId) {
      where.customerId = customerId;
    }

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.paymentDate = {};
      if (startDate) where.paymentDate.gte = new Date(startDate);
      if (endDate) where.paymentDate.lte = new Date(endDate);
    }

    if (search) {
      const term = search.trim();
      where.OR = [
        { paymentNumber: { contains: term } },
        { reference: { contains: term } },
        { customer: { name: { contains: term } } },
      ];
    }

    const [total, payments] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        skip,
        take: limitNum,
        include: {
          customer: {
            select: { id: true, name: true, email: true },
          },
          allocations: {
            include: {
              invoice: {
                select: { id: true, invoiceNumber: true, total: true, balanceDue: true, status: true },
              },
            },
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
      data: payments,
    });
  } catch (error) {
    console.error('List payments error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve payments.',
    });
  }
}

/**
 * @route   GET /api/v1/payments/:id
 * @desc    Get detailed payment record with invoice allocations
 * @access  Protected (Admin, Accountant, Customer)
 */
export async function getPaymentById(req, res) {
  try {
    const { id } = req.params;

    const payment = await prisma.payment.findFirst({
      where: {
        OR: [{ id }, { paymentNumber: id }],
      },
      include: {
        customer: {
          select: { id: true, name: true, email: true, phone: true },
        },
        allocations: {
          include: {
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                issueDate: true,
                total: true,
                amountPaid: true,
                balanceDue: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({
        status: 'error',
        code: 'PAYMENT_NOT_FOUND',
        message: `Payment '${id}' was not found.`,
      });
    }

    // Customer isolation check
    if (req.user.role === 'customer' && payment.customerId !== req.user.customerId) {
      return res.status(403).json({
        status: 'error',
        code: 'CUSTOMER_ISOLATION_VIOLATION',
        message: 'Forbidden: You do not have permission to view other customer payments.',
      });
    }

    return res.status(200).json({
      status: 'ok',
      data: payment,
    });
  } catch (error) {
    console.error('Get payment error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve payment details.',
    });
  }
}

/**
 * @route   POST /api/v1/payments
 * @desc    Record a customer payment with atomic allocations and idempotency support
 * @access  Protected (Admin, Accountant)
 */
export async function createPayment(req, res) {
  try {
    const data = req.validatedBody;
    const paymentAmount = round2(data.amount);

    // 1. Idempotency Check: Prevent duplicate payment processing
    if (data.idempotencyKey) {
      const existingPayment = await prisma.payment.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
        include: {
          customer: { select: { id: true, name: true } },
          allocations: { include: { invoice: { select: { id: true, invoiceNumber: true } } } },
        },
      });

      if (existingPayment) {
        return res.status(200).json({
          status: 'ok',
          message: 'Payment was previously recorded (idempotent response).',
          data: existingPayment,
          isDuplicate: true,
        });
      }
    }

    // 2. Validate customer exists
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

    // 3. Validate allocations sum does not exceed payment amount
    const allocations = data.allocations || [];
    let totalAllocated = 0;

    for (const alloc of allocations) {
      const allocAmount = round2(alloc.amount);
      totalAllocated = round2(totalAllocated + allocAmount);
    }

    if (totalAllocated > paymentAmount) {
      return res.status(400).json({
        status: 'error',
        code: 'ALLOCATION_EXCEEDS_PAYMENT',
        message: `Total allocated amount (£${totalAllocated.toFixed(2)}) cannot exceed total payment amount (£${paymentAmount.toFixed(2)}).`,
      });
    }

    const unallocatedAmount = round2(paymentAmount - totalAllocated);
    const paymentDate = data.paymentDate ? new Date(data.paymentDate) : new Date();

    // 4. Execute atomic transaction: record payment, update invoices, insert allocations
    const newPayment = await prisma.$transaction(async (tx) => {
      // Validate each target invoice and ensure no overpayment
      for (const alloc of allocations) {
        const inv = await tx.invoice.findFirst({
          where: { OR: [{ id: alloc.invoiceId }, { invoiceNumber: alloc.invoiceId }] },
        });

        if (!inv) {
          throw {
            statusCode: 400,
            code: 'INVOICE_NOT_FOUND',
            message: `Target invoice '${alloc.invoiceId}' does not exist.`,
          };
        }

        if (inv.customerId !== data.customerId) {
          throw {
            statusCode: 400,
            code: 'INVOICE_CUSTOMER_MISMATCH',
            message: `Invoice '${inv.invoiceNumber}' belongs to a different customer account.`,
          };
        }

        if (inv.status === 'Draft' || inv.status === 'Void') {
          throw {
            statusCode: 400,
            code: 'INVALID_INVOICE_STATUS',
            message: `Cannot allocate payment to an invoice in '${inv.status}' status.`,
          };
        }

        const allocAmount = round2(alloc.amount);
        const currentBalance = round2(inv.balanceDue);
        const currentPaid = round2(inv.amountPaid);
        const invoiceTotal = round2(inv.total);

        if (allocAmount > currentBalance) {
          throw {
            statusCode: 400,
            code: 'OVERPAYMENT_NOT_ALLOWED',
            message: `Allocated amount (£${allocAmount.toFixed(2)}) exceeds current outstanding balance (£${currentBalance.toFixed(2)}) for invoice '${inv.invoiceNumber}'.`,
          };
        }

        // Update target invoice
        const updatedPaid = round2(currentPaid + allocAmount);
        const updatedBalance = round2(Math.max(0, invoiceTotal - updatedPaid));
        const updatedStatus = updatedBalance === 0 ? 'Paid' : 'Partially Paid';

        await tx.invoice.update({
          where: { id: inv.id },
          data: {
            amountPaid: updatedPaid,
            balanceDue: updatedBalance,
            status: updatedStatus,
          },
        });

        // Normalize allocation invoiceId to UUID
        alloc.resolvedInvoiceId = inv.id;
      }

      // Generate sequential payment number (e.g. PAY-2026-001)
      const paymentNumber = await getNextPaymentNumber(tx, paymentDate.getFullYear());

      // Create Payment record
      const createdPayment = await tx.payment.create({
        data: {
          paymentNumber,
          customerId: data.customerId,
          amount: paymentAmount,
          unallocatedAmount,
          paymentDate,
          paymentMethod: data.paymentMethod,
          reference: data.reference || null,
          notes: data.notes || null,
          idempotencyKey: data.idempotencyKey || null,
          status: 'Completed',
          allocations: {
            create: allocations.map((a) => ({
              invoiceId: a.resolvedInvoiceId,
              amount: round2(a.amount),
            })),
          },
        },
        include: {
          customer: { select: { id: true, name: true } },
          allocations: {
            include: {
              invoice: { select: { id: true, invoiceNumber: true, status: true, balanceDue: true } },
            },
          },
        },
      });

      return createdPayment;
    });

    return res.status(201).json({
      status: 'ok',
      message: `Payment '${newPayment.paymentNumber}' of £${paymentAmount.toFixed(2)} recorded successfully.`,
      data: newPayment,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        status: 'error',
        code: error.code,
        message: error.message,
      });
    }
    console.error('Create payment error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to record payment.',
    });
  }
}

/**
 * @route   POST /api/v1/payments/:id/void
 * @desc    Void a payment and safely restore invoice balances and statuses
 * @access  Protected (Admin, Accountant)
 */
export async function voidPayment(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.validatedBody;

    const payment = await prisma.payment.findFirst({
      where: { OR: [{ id }, { paymentNumber: id }] },
      include: {
        allocations: {
          include: { invoice: true },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({
        status: 'error',
        code: 'PAYMENT_NOT_FOUND',
        message: `Payment '${id}' was not found.`,
      });
    }

    if (payment.status === 'Voided') {
      return res.status(400).json({
        status: 'error',
        code: 'PAYMENT_ALREADY_VOIDED',
        message: `Payment '${payment.paymentNumber}' has already been voided.`,
      });
    }

    const voidedPayment = await prisma.$transaction(async (tx) => {
      // Revert each allocation from its corresponding invoice
      for (const alloc of payment.allocations) {
        const inv = alloc.invoice;
        const currentPaid = round2(inv.amountPaid);
        const allocAmount = round2(alloc.amount);
        const invoiceTotal = round2(inv.total);
        const restoredPaid = round2(Math.max(0, currentPaid - allocAmount));
        const restoredBalance = round2(invoiceTotal - restoredPaid);

        // Determine restored status
        let restoredStatus = 'Sent';
        if (restoredPaid > 0) {
          restoredStatus = 'Partially Paid';
        } else if (new Date(inv.dueDate) < new Date()) {
          restoredStatus = 'Overdue';
        }

        await tx.invoice.update({
          where: { id: inv.id },
          data: {
            amountPaid: restoredPaid,
            balanceDue: restoredBalance,
            status: restoredStatus,
          },
        });
      }

      // Mark payment as Voided
      return tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'Voided',
          unallocatedAmount: 0.00,
          voidReason: reason,
          voidedAt: new Date(),
        },
        include: {
          customer: { select: { id: true, name: true } },
          allocations: {
            include: { invoice: { select: { id: true, invoiceNumber: true, status: true, balanceDue: true } } },
          },
        },
      });
    });

    return res.status(200).json({
      status: 'ok',
      message: `Payment '${voidedPayment.paymentNumber}' voided successfully and invoice balances restored.`,
      data: voidedPayment,
    });
  } catch (error) {
    console.error('Void payment error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to void payment.',
    });
  }
}
