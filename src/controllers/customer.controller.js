import { z } from 'zod';
import prisma from '../config/db.js';

export const createCustomerSchema = z.object({
  id: z
    .string()
    .trim()
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Customer ID can only contain letters, numbers, underscores, and dashes.')
    .optional(),
  name: z.string().trim().min(1, 'Customer or business name is required.').max(255),
  contactPerson: z.string().trim().max(255).optional().nullable(),
  email: z.string().trim().email('Must be a valid email address.').optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(50).optional().nullable(),
  address: z.string().trim().optional().nullable(),
  vatNumber: z.string().trim().max(50).optional().nullable(),
  paymentTerms: z.coerce.number().int().min(0, 'Payment terms must be 0 or more days.').default(14),
  status: z.enum(['Active', 'Inactive', 'Suspended']).default('Active'),
  openingBalance: z.coerce.number().min(0, 'Opening balance cannot be negative.').default(0),
  notes: z.string().trim().optional().nullable(),
  vanId: z.string().trim().max(50).optional().nullable(),
});

export const updateCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Customer name cannot be empty.').max(255).optional(),
  contactPerson: z.string().trim().max(255).optional().nullable(),
  email: z.string().trim().email('Must be a valid email address.').optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(50).optional().nullable(),
  address: z.string().trim().optional().nullable(),
  vatNumber: z.string().trim().max(50).optional().nullable(),
  paymentTerms: z.coerce.number().int().min(0).optional(),
  status: z.enum(['Active', 'Inactive', 'Suspended']).optional(),
  openingBalance: z.coerce.number().min(0, 'Opening balance cannot be negative.').optional(),
  notes: z.string().trim().optional().nullable(),
  vanId: z.string().trim().max(50).optional().nullable(),
});

/**
 * Generate sequential Customer ID (e.g. CUST-003) if not provided
 */
async function generateNextCustomerId() {
  const lastCustomer = await prisma.customer.findFirst({
    where: { id: { startsWith: 'CUST-' } },
    orderBy: { id: 'desc' },
  });

  if (!lastCustomer) return 'CUST-001';

  const match = lastCustomer.id.match(/^CUST-(\d+)$/);
  if (match) {
    const nextSeq = parseInt(match[1], 10) + 1;
    return `CUST-${String(nextSeq).padStart(3, '0')}`;
  }

  return `CUST-${Date.now().toString().slice(-4)}`;
}

/**
 * @route   GET /api/v1/customers
 * @desc    List customers with pagination, search, van filter, and status filter
 * @access  Protected (Admin and Accountant only)
 */
export async function listCustomers(req, res) {
  try {
    const {
      search,
      vanId,
      status,
      page = 1,
      limit = 25,
      sortBy = 'name',
      sortOrder = 'asc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (status) {
      where.status = { equals: status };
    }

    if (vanId) {
      where.vanId = { equals: vanId };
    }

    if (search) {
      const trimmedSearch = search.trim();
      where.OR = [
        { name: { contains: trimmedSearch } },
        { contactPerson: { contains: trimmedSearch } },
        { email: { contains: trimmedSearch } },
        { phone: { contains: trimmedSearch } },
        { id: { contains: trimmedSearch } },
      ];
    }

    const [total, customers] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        skip,
        take: limitNum,
        include: {
          van: {
            select: { id: true, name: true, vehicle: true },
          },
          invoices: {
            where: { status: { notIn: ['Draft', 'Void'] } },
            select: { total: true, balanceDue: true, amountPaid: true },
          },
          payments: {
            where: { status: 'Completed' },
            select: { amount: true },
          },
          _count: {
            select: { users: true },
          },
        },
        orderBy: { [sortBy]: sortOrder.toLowerCase() === 'desc' ? 'desc' : 'asc' },
      }),
    ]);

    const enrichedCustomers = customers.map((c) => {
      const opening = parseFloat(c.openingBalance) || 0;
      const invoicesList = c.invoices || [];
      const paymentsList = c.payments || [];
      const totalPurchases = invoicesList.reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
      const totalPaid = paymentsList.reduce((sum, pay) => sum + (parseFloat(pay.amount) || 0), 0);
      const outstandingBalance = Math.max(0, Math.round((opening + totalPurchases - totalPaid) * 100) / 100);
      const { invoices: _invs, payments: _pays, ...rest } = c;
      return {
        ...rest,
        totalPurchases: Math.round(totalPurchases * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        outstandingBalance,
      };
    });

    return res.status(200).json({
      status: 'ok',
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
      data: enrichedCustomers,
    });
  } catch (error) {
    console.error('List customers error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve customers directory.',
    });
  }
}

/**
 * @route   GET /api/v1/customers/:id
 * @desc    Get single customer profile (with customer role isolation)
 * @access  Protected (Admin, Accountant, or matching Customer)
 */
export async function getCustomerById(req, res) {
  try {
    const { id } = req.params;

    // Strict Customer Account Isolation:
    // If the authenticated user has the 'customer' role, they can ONLY view their own record.
    if (req.user.role === 'customer') {
      if (req.user.customerId !== id) {
        return res.status(403).json({
          status: 'error',
          code: 'CUSTOMER_ISOLATION_VIOLATION',
          message: 'Forbidden: You do not have permission to view other customer accounts.',
        });
      }
    }

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        van: {
          select: { id: true, name: true, vehicle: true },
        },
        invoices: {
          where: { status: { notIn: ['Draft', 'Void'] } },
          select: { total: true, balanceDue: true, amountPaid: true },
        },
        payments: {
          where: { status: 'Completed' },
          select: { amount: true },
        },
        users: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            lastLoginAt: true,
          },
        },
      },
    });

    if (!customer) {
      return res.status(404).json({
        status: 'error',
        code: 'CUSTOMER_NOT_FOUND',
        message: `Customer with ID '${id}' was not found.`,
      });
    }

    const opening = parseFloat(customer.openingBalance) || 0;
    const totalPurchases = (customer.invoices || []).reduce((sum, inv) => sum + (parseFloat(inv.total) || 0), 0);
    const totalPaid = (customer.payments || []).reduce((sum, pay) => sum + (parseFloat(pay.amount) || 0), 0);
    const outstandingBalance = Math.max(0, Math.round((opening + totalPurchases - totalPaid) * 100) / 100);
    const { invoices: _invs, payments: _pays, ...sanitizedCustomer } = customer;

    return res.status(200).json({
      status: 'ok',
      data: {
        ...sanitizedCustomer,
        totalPurchases: Math.round(totalPurchases * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        outstandingBalance,
      },
    });
  } catch (error) {
    console.error('Get customer error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve customer details.',
    });
  }
}

/**
 * @route   POST /api/v1/customers
 * @desc    Create a new customer account
 * @access  Protected (Admin only)
 */
export async function createCustomer(req, res) {
  try {
    const data = req.validatedBody;
    const customerId = data.id || (await generateNextCustomerId());

    // Check duplicate ID
    const existing = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (existing) {
      return res.status(409).json({
        status: 'error',
        code: 'DUPLICATE_CUSTOMER_ID',
        message: `Customer with ID '${customerId}' already exists.`,
      });
    }

    // If vanId provided, verify that the van exists
    if (data.vanId) {
      const vanExists = await prisma.van.findUnique({
        where: { id: data.vanId },
      });

      if (!vanExists) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_VAN_ID',
          message: `Delivery van with ID '${data.vanId}' does not exist.`,
        });
      }
    }

    const customer = await prisma.customer.create({
      data: {
        id: customerId,
        name: data.name,
        contactPerson: data.contactPerson || null,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        vatNumber: data.vatNumber || null,
        paymentTerms: data.paymentTerms,
        status: data.status,
        openingBalance: data.openingBalance,
        notes: data.notes || null,
        vanId: data.vanId || null,
      },
      include: {
        van: {
          select: { id: true, name: true, vehicle: true },
        },
      },
    });

    return res.status(201).json({
      status: 'ok',
      message: `Customer '${customer.name}' created successfully.`,
      data: customer,
    });
  } catch (error) {
    console.error('Create customer error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to create customer.',
    });
  }
}

/**
 * @route   PUT /api/v1/customers/:id
 * @desc    Update customer details or opening balance
 * @access  Protected (Admin only)
 */
export async function updateCustomer(req, res) {
  try {
    const { id } = req.params;
    const data = req.validatedBody;

    const existing = await prisma.customer.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        status: 'error',
        code: 'CUSTOMER_NOT_FOUND',
        message: `Customer with ID '${id}' was not found.`,
      });
    }

    // If vanId provided and not null, verify that the van exists
    if (data.vanId) {
      const vanExists = await prisma.van.findUnique({
        where: { id: data.vanId },
      });

      if (!vanExists) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_VAN_ID',
          message: `Delivery van with ID '${data.vanId}' does not exist.`,
        });
      }
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        ...data,
        email: data.email === '' ? null : data.email,
      },
      include: {
        van: {
          select: { id: true, name: true, vehicle: true },
        },
      },
    });

    return res.status(200).json({
      status: 'ok',
      message: `Customer '${updated.name}' updated successfully.`,
      data: updated,
    });
  } catch (error) {
    console.error('Update customer error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to update customer.',
    });
  }
}

/**
 * @route   DELETE /api/v1/customers/:id
 * @desc    Safely deactivate or delete customer record
 * @access  Protected (Admin only)
 */
/**
 * @route   GET /api/v1/customers/:id/statement
 * @desc    Get customer financial statement with running balance incorporating opening balance exactly once
 * @access  Protected (Admin, Accountant, or matching Customer)
 */
export async function getCustomerStatement(req, res) {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    // Customer Isolation Check
    if (req.user.role === 'customer' && req.user.customerId !== id) {
      return res.status(403).json({
        status: 'error',
        code: 'CUSTOMER_ISOLATION_VIOLATION',
        message: 'Forbidden: You do not have permission to view other customer statements.',
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        van: { select: { id: true, name: true } },
      },
    });

    if (!customer) {
      return res.status(404).json({
        status: 'error',
        code: 'CUSTOMER_NOT_FOUND',
        message: `Customer with ID '${id}' was not found.`,
      });
    }

    const invoiceWhere = {
      customerId: id,
      status: { notIn: ['Draft'] },
    };

    const paymentWhere = {
      customerId: id,
      status: 'Completed',
    };

    if (startDate || endDate) {
      invoiceWhere.issueDate = {};
      paymentWhere.paymentDate = {};
      if (startDate) {
        invoiceWhere.issueDate.gte = new Date(startDate);
        paymentWhere.paymentDate.gte = new Date(startDate);
      }
      if (endDate) {
        invoiceWhere.issueDate.lte = new Date(endDate);
        paymentWhere.paymentDate.lte = new Date(endDate);
      }
    }

    const [invoices, payments] = await Promise.all([
      prisma.invoice.findMany({
        where: invoiceWhere,
        orderBy: { issueDate: 'asc' },
        select: {
          id: true,
          invoiceNumber: true,
          issueDate: true,
          dueDate: true,
          reference: true,
          status: true,
          total: true,
          amountPaid: true,
          balanceDue: true,
        },
      }),
      prisma.payment.findMany({
        where: paymentWhere,
        orderBy: { paymentDate: 'asc' },
        select: {
          id: true,
          paymentNumber: true,
          paymentDate: true,
          paymentMethod: true,
          reference: true,
          amount: true,
          status: true,
        },
      }),
    ]);

    // Build chronological transaction ledger
    const openingBalance = parseFloat(customer.openingBalance) || 0;
    let runningBalance = openingBalance;

    const entries = [];

    // Map invoices into ledger entries
    for (const inv of invoices) {
      const invTotal = parseFloat(inv.total) || 0;
      const isVoid = inv.status === 'Void';
      const debitAmount = isVoid ? 0 : invTotal;

      entries.push({
        id: inv.id,
        date: inv.issueDate,
        type: 'INVOICE',
        reference: inv.invoiceNumber,
        description: isVoid ? `Invoice ${inv.invoiceNumber} (Voided)` : `Invoice ${inv.invoiceNumber}`,
        debit: debitAmount,
        credit: 0,
        status: inv.status,
        timestamp: new Date(inv.issueDate).getTime(),
      });
    }

    // Map payments into ledger entries
    for (const pay of payments) {
      const payAmount = parseFloat(pay.amount) || 0;
      entries.push({
        id: pay.id,
        date: pay.paymentDate,
        type: 'PAYMENT',
        reference: pay.paymentNumber,
        description: `Payment Received (${pay.paymentMethod})`,
        debit: 0,
        credit: payAmount,
        status: pay.status,
        timestamp: new Date(pay.paymentDate).getTime(),
      });
    }

    // Sort chronologically by date
    entries.sort((a, b) => a.timestamp - b.timestamp);

    // Compute running balance exactly once per transaction
    let totalInvoiced = 0;
    let totalPaid = 0;

    const transactions = entries.map((entry) => {
      if (entry.debit > 0) {
        runningBalance += entry.debit;
        totalInvoiced += entry.debit;
      }
      if (entry.credit > 0) {
        runningBalance -= entry.credit;
        totalPaid += entry.credit;
      }

      return {
        id: entry.id,
        date: entry.date,
        type: entry.type,
        reference: entry.reference,
        invoice: entry.type === 'INVOICE' ? entry.reference : '—',
        description: entry.description,
        debit: Math.round((entry.debit + Number.EPSILON) * 100) / 100,
        credit: Math.round((entry.credit + Number.EPSILON) * 100) / 100,
        balance: Math.round((runningBalance + Number.EPSILON) * 100) / 100,
        status: entry.status,
      };
    });

    return res.status(200).json({
      status: 'ok',
      data: {
        customer: {
          id: customer.id,
          name: customer.name,
          contactPerson: customer.contactPerson,
          email: customer.email,
          phone: customer.phone,
          address: customer.address,
          vatNumber: customer.vatNumber,
          van: customer.van,
        },
        statementPeriod: {
          startDate: startDate || null,
          endDate: endDate || null,
        },
        summary: {
          openingBalance: Math.round((openingBalance + Number.EPSILON) * 100) / 100,
          totalInvoiced: Math.round((totalInvoiced + Number.EPSILON) * 100) / 100,
          totalPaid: Math.round((totalPaid + Number.EPSILON) * 100) / 100,
          currentOutstandingBalance: Math.round((runningBalance + Number.EPSILON) * 100) / 100,
        },
        transactions,
      },
    });
  } catch (error) {
    console.error('Customer statement error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to generate customer statement.',
    });
  }
}

/**
 * @route   DELETE /api/v1/customers/:id
 * @desc    Safely deactivate or delete customer record
 * @access  Protected (Admin only)
 */
export async function deleteCustomer(req, res) {
  try {
    const { id } = req.params;
    const { hard } = req.query;

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: true,
            invoices: true,
            payments: true,
          },
        },
      },
    });

    if (!customer) {
      return res.status(404).json({
        status: 'error',
        code: 'CUSTOMER_NOT_FOUND',
        message: `Customer with ID '${id}' was not found.`,
      });
    }

    // Safety Policy: If linked users or financial records exist, reject permanent hard deletion
    if (hard === 'true') {
      if (customer._count.users > 0) {
        return res.status(409).json({
          status: 'error',
          code: 'CUSTOMER_HAS_LINKED_USERS',
          message: `Cannot permanently delete customer '${customer.name}' because ${customer._count.users} active user login account(s) are linked to this client. Deactivate the customer instead.`,
        });
      }

      if (customer._count.invoices > 0 || customer._count.payments > 0) {
        return res.status(409).json({
          status: 'error',
          code: 'CUSTOMER_HAS_FINANCIAL_RECORDS',
          message: `Cannot permanently delete customer '${customer.name}' because historical financial records exist (${customer._count.invoices} invoice(s), ${customer._count.payments} payment(s)). Deactivate the customer instead to preserve audit integrity.`,
        });
      }

      await prisma.customer.delete({
        where: { id },
      });

      return res.status(200).json({
        status: 'ok',
        message: `Customer '${customer.name}' permanently deleted.`,
      });
    }

    // Default Safe Deletion Policy: Soft-deactivate by setting status to 'Inactive'
    const deactivated = await prisma.customer.update({
      where: { id },
      data: { status: 'Inactive' },
    });

    return res.status(200).json({
      status: 'ok',
      message: `Customer '${deactivated.name}' deactivated successfully (Status: Inactive).`,
      data: deactivated,
    });
  } catch (error) {
    console.error('Delete customer error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to delete customer.',
    });
  }
}

