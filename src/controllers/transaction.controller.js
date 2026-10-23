import { z } from 'zod';
import prisma from '../config/db.js';

export const createTransactionSchema = z.object({
  date: z.string().trim().min(1, 'Date is required.'),
  type: z.enum(['Income', 'Expense', 'Purchase'], {
    errorMap: () => ({ message: 'Type must be Income, Expense, or Purchase.' }),
  }),
  category: z.string().trim().min(1, 'Category is required.').max(100),
  description: z.string().trim().min(1, 'Description is required.').max(255),
  reference: z.string().trim().max(100).optional().nullable(),
  customerOrSupplier: z.string().trim().max(255).optional().nullable(),
  netAmount: z.number().min(0, 'Net amount must be greater than or equal to 0.'),
  vatAmount: z.number().min(0).default(0),
  grossAmount: z.number().min(0).optional(),
  status: z.string().trim().max(50).default('Completed'),
  notes: z.string().trim().optional().nullable(),
});

export const updateTransactionSchema = z.object({
  date: z.string().trim().min(1).optional(),
  type: z.enum(['Income', 'Expense', 'Purchase']).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().min(1).max(255).optional(),
  reference: z.string().trim().max(100).optional().nullable(),
  customerOrSupplier: z.string().trim().max(255).optional().nullable(),
  netAmount: z.number().min(0).optional(),
  vatAmount: z.number().min(0).optional(),
  grossAmount: z.number().min(0).optional(),
  status: z.string().trim().max(50).optional(),
  notes: z.string().trim().optional().nullable(),
});

export const batchImportSchema = z.object({
  transactions: z.array(
    z.object({
      id: z.string().optional(),
      date: z.string(),
      type: z.string(),
      category: z.string(),
      description: z.string(),
      reference: z.string().optional().nullable(),
      customerOrSupplier: z.string().optional().nullable(),
      netAmount: z.number().or(z.string()),
      vatAmount: z.number().or(z.string()).optional(),
      grossAmount: z.number().or(z.string()).optional(),
      status: z.string().optional(),
    })
  ).min(1, 'At least one transaction is required for import.'),
});

/**
 * Helper to generate unique transaction number
 */
async function generateNextTransactionNumber(tx) {
  const currentYear = new Date().getFullYear();
  const prefix = `TXN-${currentYear}-`;
  const lastTxn = await tx.transaction.findFirst({
    where: { transactionNumber: { startsWith: prefix } },
    orderBy: { transactionNumber: 'desc' },
  });

  let nextSeq = 101;
  if (lastTxn?.transactionNumber) {
    const parts = lastTxn.transactionNumber.split('-');
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num)) nextSeq = num + 1;
  }
  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

/**
 * @route   GET /api/v1/transactions
 * @desc    List income & expense transactions with filtering
 * @access  Protected (Admin, Accountant)
 */
export async function listTransactions(req, res) {
  try {
    const { type, category, startDate, endDate, search, limit = '200', page = '1' } = req.query;

    const where = {};
    if (type && type !== 'all') {
      where.type = type;
    }
    if (category && category !== 'all') {
      where.category = category;
    }
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }
    if (search) {
      where.OR = [
        { transactionNumber: { contains: search } },
        { description: { contains: search } },
        { reference: { contains: search } },
        { customerOrSupplier: { contains: search } },
      ];
    }

    const take = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));
    const skip = ((parseInt(page, 10) || 1) - 1) * take;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take,
        skip,
      }),
      prisma.transaction.count({ where }),
    ]);

    const formatted = transactions.map((t) => ({
      id: t.id,
      transactionNumber: t.transactionNumber,
      date: t.date ? t.date.toISOString().split('T')[0] : '',
      type: t.type,
      category: t.category,
      description: t.description,
      reference: t.reference,
      customerOrSupplier: t.customerOrSupplier,
      netAmount: parseFloat(t.netAmount) || 0,
      vatAmount: parseFloat(t.vatAmount) || 0,
      grossAmount: parseFloat(t.grossAmount) || 0,
      status: t.status,
      notes: t.notes,
      createdAt: t.createdAt,
    }));

    return res.status(200).json({
      status: 'ok',
      total,
      page: parseInt(page, 10) || 1,
      limit: take,
      data: formatted,
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve transactions.',
    });
  }
}

/**
 * @route   POST /api/v1/transactions
 * @desc    Create new cashflow transaction
 * @access  Protected (Admin, Accountant)
 */
export async function createTransaction(req, res) {
  try {
    const data = req.validatedBody;
    const net = parseFloat(data.netAmount) || 0;
    const vat = parseFloat(data.vatAmount) || 0;
    const gross = data.grossAmount !== undefined ? parseFloat(data.grossAmount) : net + vat;

    const created = await prisma.$transaction(async (tx) => {
      const transactionNumber = await generateNextTransactionNumber(tx);
      return tx.transaction.create({
        data: {
          transactionNumber,
          date: new Date(data.date),
          type: data.type,
          category: data.category,
          description: data.description,
          reference: data.reference || null,
          customerOrSupplier: data.customerOrSupplier || null,
          netAmount: net,
          vatAmount: vat,
          grossAmount: gross,
          status: data.status || 'Completed',
          notes: data.notes || null,
        },
      });
    });

    return res.status(201).json({
      status: 'ok',
      message: 'Transaction recorded successfully.',
      data: {
        id: created.id,
        transactionNumber: created.transactionNumber,
        date: created.date.toISOString().split('T')[0],
        type: created.type,
        category: created.category,
        description: created.description,
        reference: created.reference,
        customerOrSupplier: created.customerOrSupplier,
        netAmount: parseFloat(created.netAmount),
        vatAmount: parseFloat(created.vatAmount),
        grossAmount: parseFloat(created.grossAmount),
        status: created.status,
      },
    });
  } catch (error) {
    console.error('Error creating transaction:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to create transaction.',
    });
  }
}

/**
 * @route   PUT /api/v1/transactions/:id
 * @desc    Update an existing transaction
 * @access  Protected (Admin, Accountant)
 */
export async function updateTransaction(req, res) {
  const { id } = req.params;
  const data = req.validatedBody;

  try {
    const existing = await prisma.transaction.findFirst({
      where: { OR: [{ id }, { transactionNumber: id }] },
    });

    if (!existing) {
      return res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Transaction not found.',
      });
    }

    const net = data.netAmount !== undefined ? parseFloat(data.netAmount) : parseFloat(existing.netAmount);
    const vat = data.vatAmount !== undefined ? parseFloat(data.vatAmount) : parseFloat(existing.vatAmount);
    const gross = data.grossAmount !== undefined ? parseFloat(data.grossAmount) : net + vat;

    const updatePayload = {
      netAmount: net,
      vatAmount: vat,
      grossAmount: gross,
    };

    if (data.date) updatePayload.date = new Date(data.date);
    if (data.type) updatePayload.type = data.type;
    if (data.category) updatePayload.category = data.category;
    if (data.description) updatePayload.description = data.description;
    if (data.reference !== undefined) updatePayload.reference = data.reference;
    if (data.customerOrSupplier !== undefined) updatePayload.customerOrSupplier = data.customerOrSupplier;
    if (data.status) updatePayload.status = data.status;
    if (data.notes !== undefined) updatePayload.notes = data.notes;

    const updated = await prisma.transaction.update({
      where: { id: existing.id },
      data: updatePayload,
    });

    return res.status(200).json({
      status: 'ok',
      message: 'Transaction updated successfully.',
      data: {
        id: updated.id,
        transactionNumber: updated.transactionNumber,
        date: updated.date.toISOString().split('T')[0],
        type: updated.type,
        category: updated.category,
        description: updated.description,
        reference: updated.reference,
        customerOrSupplier: updated.customerOrSupplier,
        netAmount: parseFloat(updated.netAmount),
        vatAmount: parseFloat(updated.vatAmount),
        grossAmount: parseFloat(updated.grossAmount),
        status: updated.status,
      },
    });
  } catch (error) {
    console.error('Error updating transaction:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to update transaction.',
    });
  }
}

/**
 * @route   DELETE /api/v1/transactions/:id
 * @desc    Delete a transaction
 * @access  Protected (Admin only)
 */
export async function deleteTransaction(req, res) {
  const { id } = req.params;

  try {
    const existing = await prisma.transaction.findFirst({
      where: { OR: [{ id }, { transactionNumber: id }] },
    });

    if (!existing) {
      return res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Transaction not found.',
      });
    }

    await prisma.transaction.delete({
      where: { id: existing.id },
    });

    return res.status(200).json({
      status: 'ok',
      message: `Transaction ${existing.transactionNumber} deleted successfully.`,
    });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to delete transaction.',
    });
  }
}

/**
 * @route   POST /api/v1/transactions/import-batch
 * @desc    Explicit, duplicate-safe import of localStorage records
 * @access  Protected (Admin only)
 */
export async function importTransactionsBatch(req, res) {
  try {
    const { transactions } = req.validatedBody;

    let importedCount = 0;
    let skippedCount = 0;

    await prisma.$transaction(async (tx) => {
      for (const item of transactions) {
        const net = parseFloat(item.netAmount) || 0;
        const vat = parseFloat(item.vatAmount) || 0;
        const gross = item.grossAmount !== undefined ? parseFloat(item.grossAmount) : net + vat;
        const dateVal = new Date(item.date);

        // Check if an existing transaction has this transactionNumber or match on (date, description, gross)
        let exists = false;
        if (item.id && (item.id.startsWith('TXN-') || item.transactionNumber)) {
          const checkNum = item.transactionNumber || item.id;
          const found = await tx.transaction.findUnique({
            where: { transactionNumber: checkNum },
          });
          if (found) exists = true;
        }

        if (!exists) {
          const foundDuplicate = await tx.transaction.findFirst({
            where: {
              date: dateVal,
              description: item.description,
              grossAmount: gross,
            },
          });
          if (foundDuplicate) exists = true;
        }

        if (exists) {
          skippedCount++;
          continue;
        }

        const txnNum =
          item.transactionNumber ||
          (item.id && item.id.startsWith('TXN-') ? item.id : await generateNextTransactionNumber(tx));

        await tx.transaction.create({
          data: {
            transactionNumber: txnNum,
            date: dateVal,
            type: item.type || 'Expense',
            category: item.category || 'General',
            description: item.description || 'Imported Transaction',
            reference: item.reference || null,
            customerOrSupplier: item.customerOrSupplier || null,
            netAmount: net,
            vatAmount: vat,
            grossAmount: gross,
            status: item.status || 'Completed',
          },
        });
        importedCount++;
      }
    });

    return res.status(200).json({
      status: 'ok',
      message: `Batch import complete. ${importedCount} imported, ${skippedCount} duplicate(s) skipped.`,
      importedCount,
      skippedCount,
    });
  } catch (error) {
    console.error('Error during batch transaction import:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to import transactions.',
    });
  }
}
