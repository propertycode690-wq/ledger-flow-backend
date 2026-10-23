import { z } from 'zod';
import prisma from '../config/db.js';
import { getNextPurchaseNumber, getNextSupplierId } from '../utils/sequence.js';
import { round2 } from '../utils/money.js';

export const purchaseItemSchema = z.object({
  productId: z.string().trim().max(50).optional().nullable(),
  product: z.string().trim().min(1, 'Product description or name is required.').max(255),
  quantity: z.coerce.number().positive('Quantity must be greater than zero.'),
  unit: z.string().trim().min(1).max(50).default('kg'),
  unitCost: z.coerce.number().min(0, 'Unit cost cannot be negative.'),
  vatRate: z.coerce.number().min(0, 'VAT rate cannot be negative.').default(0),
});

export const createPurchaseSchema = z.object({
  supplierId: z.string().trim().max(50).optional().nullable(),
  supplierName: z.string().trim().min(1, 'Supplier name is required.').max(255),
  supplierInvoiceNo: z.string().trim().max(100).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format.').optional(),
  status: z.enum(['Paid', 'Pending', 'Cancelled']).default('Paid'),
  notes: z.string().trim().optional().nullable(),
  items: z.array(purchaseItemSchema).min(1, 'Purchase bill must contain at least one line item.'),
});

export const updatePurchaseSchema = z.object({
  supplierId: z.string().trim().max(50).optional().nullable(),
  supplierName: z.string().trim().min(1).max(255).optional(),
  supplierInvoiceNo: z.string().trim().max(100).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format.').optional(),
  status: z.enum(['Paid', 'Pending', 'Cancelled']).optional(),
  notes: z.string().trim().optional().nullable(),
  items: z.array(purchaseItemSchema).min(1).optional(),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Supplier name is required.').max(255),
  contactPerson: z.string().trim().max(255).optional().nullable(),
  email: z.string().trim().email('Invalid email address').max(255).optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(50).optional().nullable(),
  address: z.string().trim().optional().nullable(),
  vatNumber: z.string().trim().max(50).optional().nullable(),
  paymentTerms: z.coerce.number().int().min(0).default(30),
  status: z.enum(['Active', 'Inactive']).default('Active'),
});

export const batchImportSchema = z.object({
  purchases: z.array(
    z.object({
      id: z.string().optional(),
      purchaseNumber: z.string().optional(),
      supplierName: z.string().trim().min(1),
      supplierInvoiceNo: z.string().trim().optional().nullable(),
      date: z.string().optional(),
      status: z.string().optional(),
      subtotal: z.coerce.number().optional(),
      vatAmount: z.coerce.number().optional(),
      total: z.coerce.number().optional(),
      notes: z.string().optional().nullable(),
      items: z.array(
        z.object({
          productId: z.string().optional().nullable(),
          product: z.string().optional(),
          name: z.string().optional(),
          quantity: z.coerce.number().positive(),
          unit: z.string().optional(),
          unitCost: z.coerce.number().min(0).optional(),
          rate: z.coerce.number().min(0).optional(),
          vatRate: z.coerce.number().optional(),
          total: z.coerce.number().optional(),
        }).transform((it) => ({
          ...it,
          unitCost: it.unitCost !== undefined ? it.unitCost : (it.rate !== undefined ? it.rate : 0),
        }))
      ).min(1),
    })
  ).min(1, 'No purchase records provided for import.'),
});

/**
 * Helper to compute calculated item lines and overall purchase totals
 */
function computePurchaseTotals(items) {
  let subtotal = 0;
  let vatAmount = 0;

  const processedItems = items.map((it) => {
    const q = round2(it.quantity);
    const cost = round2(it.unitCost !== undefined ? it.unitCost : (it.rate || 0));
    const rate = round2(it.vatRate || 0);

    const rowSubtotal = round2(q * cost);
    const rowVat = round2(rowSubtotal * (rate / 100));
    const rowTotal = round2(rowSubtotal + rowVat);

    subtotal = round2(subtotal + rowSubtotal);
    vatAmount = round2(vatAmount + rowVat);

    return {
      productId: it.productId || null,
      product: it.product || it.name || 'Wholesale Item',
      quantity: q,
      unit: it.unit || 'kg',
      unitCost: cost,
      vatRate: rate,
      vatAmount: rowVat,
      total: rowTotal,
    };
  });

  const total = round2(subtotal + vatAmount);
  return { processedItems, subtotal, vatAmount, total };
}

/**
 * @route   GET /api/v1/purchases
 * @desc    List wholesale purchase bills with filtering, search and pagination
 * @access  Protected (Admin, Accountant)
 */
export async function listPurchases(req, res) {
  try {
    const {
      page = 1,
      limit = 25,
      search,
      status,
      supplierId,
      startDate,
      endDate,
      sortBy = 'date',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (status && status !== 'All') {
      where.status = status;
    }

    if (supplierId) {
      where.supplierId = supplierId;
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) where.date.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) where.date.lte = end;
      }
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { purchaseNumber: { contains: q } },
        { supplierName: { contains: q } },
        { supplierInvoiceNo: { contains: q } },
        { notes: { contains: q } },
        { items: { some: { product: { contains: q } } } },
      ];
    }

    const allowedSortFields = ['date', 'createdAt', 'purchaseNumber', 'total', 'status'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'date';
    const sortDir = sortOrder.toLowerCase() === 'asc' ? 'asc' : 'desc';

    const [purchases, totalCount, aggregateTotals, pendingAggregate] = await Promise.all([
      prisma.purchase.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: [{ [sortField]: sortDir }, { createdAt: 'desc' }],
        include: {
          supplier: {
            select: { id: true, name: true, phone: true, email: true },
          },
          items: true,
        },
      }),
      prisma.purchase.count({ where }),
      prisma.purchase.aggregate({
        where: { ...where, status: { not: 'Cancelled' } },
        _sum: {
          subtotal: true,
          vatAmount: true,
          total: true,
        },
      }),
      prisma.purchase.aggregate({
        where: { ...where, status: 'Pending' },
        _sum: { total: true },
        _count: { id: true },
      }),
    ]);

    const formatted = purchases.map((p) => ({
      id: p.id,
      purchaseNumber: p.purchaseNumber,
      supplierId: p.supplierId,
      supplierName: p.supplierName,
      supplierInvoiceNo: p.supplierInvoiceNo,
      date: p.date.toISOString().split('T')[0],
      status: p.status,
      subtotal: parseFloat(p.subtotal.toString()),
      vatAmount: parseFloat(p.vatAmount.toString()),
      total: parseFloat(p.total.toString()),
      notes: p.notes,
      items: p.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        product: i.product,
        quantity: parseFloat(i.quantity.toString()),
        unit: i.unit,
        unitCost: parseFloat(i.unitCost.toString()),
        vatRate: parseFloat(i.vatRate.toString()),
        vatAmount: parseFloat(i.vatAmount.toString()),
        total: parseFloat(i.total.toString()),
      })),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    return res.status(200).json({
      status: 'success',
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum) || 1,
      },
      summary: {
        totalPurchases: aggregateTotals._sum.total ? parseFloat(aggregateTotals._sum.total.toString()) : 0,
        totalSubtotal: aggregateTotals._sum.subtotal ? parseFloat(aggregateTotals._sum.subtotal.toString()) : 0,
        totalVat: aggregateTotals._sum.vatAmount ? parseFloat(aggregateTotals._sum.vatAmount.toString()) : 0,
        pendingAmount: pendingAggregate._sum.total ? parseFloat(pendingAggregate._sum.total.toString()) : 0,
        pendingCount: pendingAggregate._count.id || 0,
      },
      data: formatted,
    });
  } catch (error) {
    console.error('listPurchases error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve purchase records.',
    });
  }
}

/**
 * @route   GET /api/v1/purchases/:id
 * @desc    Retrieve detailed single purchase record with line items
 * @access  Protected (Admin, Accountant)
 */
export async function getPurchaseById(req, res) {
  try {
    const { id } = req.params;

    const purchase = await prisma.purchase.findFirst({
      where: {
        OR: [{ id }, { purchaseNumber: id }],
      },
      include: {
        supplier: true,
        items: true,
      },
    });

    if (!purchase) {
      return res.status(404).json({
        status: 'error',
        code: 'PURCHASE_NOT_FOUND',
        message: `Purchase bill '${id}' was not found.`,
      });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        id: purchase.id,
        purchaseNumber: purchase.purchaseNumber,
        supplierId: purchase.supplierId,
        supplierName: purchase.supplierName,
        supplierInvoiceNo: purchase.supplierInvoiceNo,
        date: purchase.date.toISOString().split('T')[0],
        status: purchase.status,
        subtotal: parseFloat(purchase.subtotal.toString()),
        vatAmount: parseFloat(purchase.vatAmount.toString()),
        total: parseFloat(purchase.total.toString()),
        notes: purchase.notes,
        supplier: purchase.supplier,
        items: purchase.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          product: i.product,
          quantity: parseFloat(i.quantity.toString()),
          unit: i.unit,
          unitCost: parseFloat(i.unitCost.toString()),
          vatRate: parseFloat(i.vatRate.toString()),
          vatAmount: parseFloat(i.vatAmount.toString()),
          total: parseFloat(i.total.toString()),
        })),
        createdAt: purchase.createdAt,
        updatedAt: purchase.updatedAt,
      },
    });
  } catch (error) {
    console.error('getPurchaseById error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve purchase details.',
    });
  }
}

/**
 * @route   POST /api/v1/purchases
 * @desc    Record new wholesale purchase bill with validation & duplicate protection
 * @access  Protected (Admin, Accountant)
 */
export async function createPurchase(req, res) {
  try {
    const data = req.validatedBody || req.body;
    const { supplierName, supplierInvoiceNo, date, status = 'Paid', notes, items } = data;

    const dateStr = date || new Date().toISOString().split('T')[0];
    const targetDate = new Date(dateStr);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_DATE',
        message: 'Invalid purchase date provided.',
      });
    }

    // Duplicate Supplier Invoice Number Protection
    if (supplierInvoiceNo && supplierInvoiceNo.trim()) {
      const existingDuplicate = await prisma.purchase.findFirst({
        where: {
          supplierInvoiceNo: supplierInvoiceNo.trim(),
          supplierName: { equals: supplierName.trim() },
          status: { not: 'Cancelled' },
        },
      });

      if (existingDuplicate) {
        return res.status(409).json({
          status: 'error',
          code: 'DUPLICATE_SUPPLIER_INVOICE',
          message: `Purchase bill '${supplierInvoiceNo.trim()}' from '${supplierName.trim()}' is already recorded (${existingDuplicate.purchaseNumber}).`,
        });
      }
    }

    const { processedItems, subtotal, vatAmount, total } = computePurchaseTotals(items);

    const year = targetDate.getFullYear();

    const created = await prisma.$transaction(async (tx) => {
      // Find or auto-create supplier catalog record for future analytics
      let supplierId = data.supplierId || null;
      if (!supplierId) {
        const existingSupplier = await tx.supplier.findFirst({
          where: { name: supplierName.trim() },
        });
        if (existingSupplier) {
          supplierId = existingSupplier.id;
        } else {
          const nextSupId = await getNextSupplierId(tx);
          const newSup = await tx.supplier.create({
            data: {
              id: nextSupId,
              name: supplierName.trim(),
            },
          });
          supplierId = newSup.id;
        }
      }

      const purchaseNumber = await getNextPurchaseNumber(tx, year);

      const purchase = await tx.purchase.create({
        data: {
          purchaseNumber,
          supplierId,
          supplierName: supplierName.trim(),
          supplierInvoiceNo: supplierInvoiceNo?.trim() || null,
          date: targetDate,
          status,
          subtotal,
          vatAmount,
          total,
          notes: notes?.trim() || null,
          items: {
            create: processedItems.map((item) => ({
              productId: item.productId,
              product: item.product,
              quantity: item.quantity,
              unit: item.unit,
              unitCost: item.unitCost,
              vatRate: item.vatRate,
              vatAmount: item.vatAmount,
              total: item.total,
            })),
          },
        },
        include: {
          items: true,
          supplier: true,
        },
      });

      return purchase;
    });

    return res.status(201).json({
      status: 'success',
      message: `Purchase bill ${created.purchaseNumber} recorded successfully.`,
      data: {
        id: created.id,
        purchaseNumber: created.purchaseNumber,
        supplierName: created.supplierName,
        supplierInvoiceNo: created.supplierInvoiceNo,
        date: created.date.toISOString().split('T')[0],
        status: created.status,
        subtotal: parseFloat(created.subtotal.toString()),
        vatAmount: parseFloat(created.vatAmount.toString()),
        total: parseFloat(created.total.toString()),
        items: created.items,
      },
    });
  } catch (error) {
    console.error('createPurchase error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to create purchase record.',
    });
  }
}

/**
 * @route   PUT /api/v1/purchases/:id
 * @desc    Update purchase bill details or line items
 * @access  Protected (Admin, Accountant)
 */
export async function updatePurchase(req, res) {
  try {
    const { id } = req.params;
    const data = req.validatedBody || req.body;

    const existing = await prisma.purchase.findFirst({
      where: { OR: [{ id }, { purchaseNumber: id }] },
      include: { items: true },
    });

    if (!existing) {
      return res.status(404).json({
        status: 'error',
        code: 'PURCHASE_NOT_FOUND',
        message: `Purchase '${id}' does not exist.`,
      });
    }

    if (existing.status === 'Cancelled' && data.status !== 'Paid' && data.status !== 'Pending') {
      return res.status(400).json({
        status: 'error',
        code: 'CANNOT_MODIFY_CANCELLED_PURCHASE',
        message: 'Cancelled purchase bills cannot be modified.',
      });
    }

    let updateData = {};
    if (data.supplierName) updateData.supplierName = data.supplierName.trim();
    if (data.supplierInvoiceNo !== undefined) updateData.supplierInvoiceNo = data.supplierInvoiceNo?.trim() || null;
    if (data.status) updateData.status = data.status;
    if (data.notes !== undefined) updateData.notes = data.notes?.trim() || null;
    if (data.date) {
      const d = new Date(data.date);
      if (!isNaN(d.getTime())) updateData.date = d;
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (data.items && Array.isArray(data.items)) {
        const { processedItems, subtotal, vatAmount, total } = computePurchaseTotals(data.items);
        updateData.subtotal = subtotal;
        updateData.vatAmount = vatAmount;
        updateData.total = total;

        await tx.purchaseItem.deleteMany({ where: { purchaseId: existing.id } });
        await tx.purchaseItem.createMany({
          data: processedItems.map((item) => ({
            purchaseId: existing.id,
            productId: item.productId,
            product: item.product,
            quantity: item.quantity,
            unit: item.unit,
            unitCost: item.unitCost,
            vatRate: item.vatRate,
            vatAmount: item.vatAmount,
            total: item.total,
          })),
        });
      }

      return tx.purchase.update({
        where: { id: existing.id },
        data: updateData,
        include: { items: true, supplier: true },
      });
    });

    return res.status(200).json({
      status: 'success',
      message: `Purchase ${updated.purchaseNumber} updated successfully.`,
      data: {
        id: updated.id,
        purchaseNumber: updated.purchaseNumber,
        supplierName: updated.supplierName,
        status: updated.status,
        subtotal: parseFloat(updated.subtotal.toString()),
        vatAmount: parseFloat(updated.vatAmount.toString()),
        total: parseFloat(updated.total.toString()),
      },
    });
  } catch (error) {
    console.error('updatePurchase error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to update purchase.',
    });
  }
}

/**
 * @route   DELETE /api/v1/purchases/:id
 * @desc    Safely void or delete purchase bill
 * @access  Protected (Admin only)
 */
export async function deletePurchase(req, res) {
  try {
    const { id } = req.params;
    const { hard = false } = req.query;

    const existing = await prisma.purchase.findFirst({
      where: { OR: [{ id }, { purchaseNumber: id }] },
    });

    if (!existing) {
      return res.status(404).json({
        status: 'error',
        code: 'PURCHASE_NOT_FOUND',
        message: `Purchase '${id}' not found.`,
      });
    }

    if (hard === 'true' || hard === true) {
      await prisma.purchase.delete({ where: { id: existing.id } });
      return res.status(200).json({
        status: 'success',
        message: `Purchase bill ${existing.purchaseNumber} permanently deleted.`,
      });
    }

    // Default safe action: soft-cancel preserving accounting audit record
    const cancelled = await prisma.purchase.update({
      where: { id: existing.id },
      data: { status: 'Cancelled' },
    });

    return res.status(200).json({
      status: 'success',
      message: `Purchase bill ${cancelled.purchaseNumber} status set to Cancelled.`,
      data: cancelled,
    });
  } catch (error) {
    console.error('deletePurchase error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to delete purchase.',
    });
  }
}

/**
 * @route   GET /api/v1/purchases/suppliers
 * @desc    List distinct suppliers catalog
 * @access  Protected (Admin, Accountant)
 */
export async function listSuppliers(req, res) {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { purchases: true } },
      },
    });

    return res.status(200).json({
      status: 'success',
      data: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        contactPerson: s.contactPerson,
        email: s.email,
        phone: s.phone,
        address: s.address,
        vatNumber: s.vatNumber,
        paymentTerms: s.paymentTerms,
        status: s.status,
        purchaseCount: s._count.purchases,
      })),
    });
  } catch (error) {
    console.error('listSuppliers error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve suppliers list.',
    });
  }
}

/**
 * @route   POST /api/v1/purchases/import-preview
 * @desc    Preview local storage purchases for duplicate-safe migration
 * @access  Protected (Admin only)
 */
export async function previewBatchImport(req, res) {
  try {
    const { purchases } = req.validatedBody || req.body;

    const existingPurchases = await prisma.purchase.findMany({
      select: {
        id: true,
        purchaseNumber: true,
        supplierName: true,
        supplierInvoiceNo: true,
        total: true,
      },
    });

    const existingNumbers = new Set(existingPurchases.map((p) => p.purchaseNumber.toLowerCase()));
    const existingInvoices = new Set(
      existingPurchases
        .filter((p) => p.supplierInvoiceNo)
        .map((p) => `${p.supplierName.toLowerCase()}||${p.supplierInvoiceNo.toLowerCase()}`)
    );

    const candidates = [];
    let duplicatesCount = 0;
    let newCount = 0;
    let totalImportAmount = 0;

    for (const item of purchases) {
      const numMatch = item.purchaseNumber && existingNumbers.has(item.purchaseNumber.toLowerCase());
      const invMatch =
        item.supplierInvoiceNo &&
        existingInvoices.has(`${item.supplierName.toLowerCase()}||${item.supplierInvoiceNo.toLowerCase()}`);

      const isDuplicate = numMatch || invMatch;
      const { subtotal, vatAmount, total } = computePurchaseTotals(item.items || []);

      if (isDuplicate) {
        duplicatesCount++;
      } else {
        newCount++;
        totalImportAmount = round2(totalImportAmount + total);
      }

      candidates.push({
        supplierName: item.supplierName,
        supplierInvoiceNo: item.supplierInvoiceNo || null,
        purchaseNumber: item.purchaseNumber || 'Auto-assign',
        date: item.date || new Date().toISOString().split('T')[0],
        status: item.status || 'Paid',
        itemCount: (item.items || []).length,
        subtotal,
        vatAmount,
        total,
        isDuplicate,
        duplicateReason: numMatch
          ? `Purchase number '${item.purchaseNumber}' already exists`
          : invMatch
          ? `Invoice '${item.supplierInvoiceNo}' from '${item.supplierName}' already exists`
          : null,
      });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        totalRecords: purchases.length,
        newRecordsCount: newCount,
        duplicatesCount,
        totalImportAmount,
        preview: candidates,
      },
    });
  } catch (error) {
    console.error('previewBatchImport error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to process import preview.',
    });
  }
}

/**
 * @route   POST /api/v1/purchases/import
 * @desc    Execute duplicate-safe migration of verified purchases
 * @access  Protected (Admin only)
 */
export async function executeBatchImport(req, res) {
  try {
    const { purchases } = req.validatedBody || req.body;

    const existingPurchases = await prisma.purchase.findMany({
      select: {
        purchaseNumber: true,
        supplierName: true,
        supplierInvoiceNo: true,
      },
    });

    const existingNumbers = new Set(existingPurchases.map((p) => p.purchaseNumber.toLowerCase()));
    const existingInvoices = new Set(
      existingPurchases
        .filter((p) => p.supplierInvoiceNo)
        .map((p) => `${p.supplierName.toLowerCase()}||${p.supplierInvoiceNo.toLowerCase()}`)
    );

    let importedCount = 0;
    let skippedCount = 0;

    await prisma.$transaction(async (tx) => {
      for (const item of purchases) {
        const numMatch = item.purchaseNumber && existingNumbers.has(item.purchaseNumber.toLowerCase());
        const invMatch =
          item.supplierInvoiceNo &&
          existingInvoices.has(`${item.supplierName.toLowerCase()}||${item.supplierInvoiceNo.toLowerCase()}`);

        if (numMatch || invMatch) {
          skippedCount++;
          continue;
        }

        const dateStr = item.date || new Date().toISOString().split('T')[0];
        const targetDate = new Date(dateStr);
        const year = targetDate.getFullYear();

        const { processedItems, subtotal, vatAmount, total } = computePurchaseTotals(item.items || []);

        let purchaseNumber = item.purchaseNumber;
        if (!purchaseNumber || existingNumbers.has(purchaseNumber.toLowerCase())) {
          purchaseNumber = await getNextPurchaseNumber(tx, year);
        }

        // Supplier catalog record check
        let supplierId = null;
        const sup = await tx.supplier.findFirst({
          where: { name: item.supplierName.trim() },
        });
        if (sup) {
          supplierId = sup.id;
        } else {
          const nextSupId = await getNextSupplierId(tx);
          const newSup = await tx.supplier.create({
            data: { id: nextSupId, name: item.supplierName.trim() },
          });
          supplierId = newSup.id;
        }

        await tx.purchase.create({
          data: {
            purchaseNumber,
            supplierId,
            supplierName: item.supplierName.trim(),
            supplierInvoiceNo: item.supplierInvoiceNo?.trim() || null,
            date: targetDate,
            status: item.status || 'Paid',
            subtotal,
            vatAmount,
            total,
            notes: item.notes || null,
            items: {
              create: processedItems.map((pi) => ({
                productId: pi.productId,
                product: pi.product,
                quantity: pi.quantity,
                unit: pi.unit,
                unitCost: pi.unitCost,
                vatRate: pi.vatRate,
                vatAmount: pi.vatAmount,
                total: pi.total,
              })),
            },
          },
        });

        existingNumbers.add(purchaseNumber.toLowerCase());
        importedCount++;
      }
    });

    return res.status(200).json({
      status: 'success',
      message: `Batch import completed: ${importedCount} purchases imported, ${skippedCount} duplicates skipped.`,
      data: {
        importedCount,
        createdCount: importedCount,
        skippedCount,
      },
    });
  } catch (error) {
    console.error('executeBatchImport error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to execute batch purchase import.',
    });
  }
}
