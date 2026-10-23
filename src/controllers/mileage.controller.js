import { z } from 'zod';
import prisma from '../config/db.js';
import { getNextMileageNumber, getNextExpenseNumber } from '../utils/sequence.js';
import { round2 } from '../utils/money.js';

export const createMileageSchema = z.object({
  vanId: z.string().trim().max(50).optional().nullable(),
  vehicle: z.string().trim().max(150).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format.').optional(),
  startMileage: z.coerce.number().min(0, 'Starting mileage cannot be negative.'),
  endMileage: z.coerce.number().min(0, 'Ending mileage cannot be negative.'),
  distanceUnit: z.enum(['miles', 'km']).default('miles'),
  purpose: z.string().trim().min(1, 'Journey purpose is required.').max(255),
  rate: z.coerce.number().min(0, 'Mileage rate cannot be negative.').optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  allowCorrection: z.boolean().default(false),
});

export const updateMileageSchema = z.object({
  vanId: z.string().trim().max(50).optional().nullable(),
  vehicle: z.string().trim().max(150).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format.').optional(),
  startMileage: z.coerce.number().min(0).optional(),
  endMileage: z.coerce.number().min(0).optional(),
  distanceUnit: z.enum(['miles', 'km']).optional(),
  purpose: z.string().trim().min(1).max(255).optional(),
  rate: z.coerce.number().min(0).optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  allowCorrection: z.boolean().default(false),
});

export const createExpenseSchema = z.object({
  vanId: z.string().trim().max(50).optional().nullable(),
  vehicle: z.string().trim().max(150).optional().nullable(),
  mileageId: z.string().trim().max(36).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format.').optional(),
  category: z.string().trim().min(1, 'Expense category is required.').max(100),
  description: z.string().trim().min(1, 'Description is required.').max(255),
  amount: z.coerce.number().positive('Expense amount must be greater than zero.'),
  notes: z.string().trim().optional().nullable(),
});

export const voidExpenseSchema = z.object({
  reason: z.string().trim().min(3, 'A valid reason for voiding this expense is required.').max(255),
});

/**
 * @route   GET /api/v1/mileage
 * @desc    List vehicle mileage records with pagination, van, and date filters
 * @access  Protected (Admin, Accountant)
 */
export async function listMileage(req, res) {
  try {
    const {
      page = 1,
      limit = 25,
      search,
      vanId,
      startDate,
      endDate,
      recordedInExpenses,
      sortBy = 'date',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (vanId) {
      where.vanId = vanId;
    }

    if (recordedInExpenses !== undefined) {
      where.recordedInExpenses = recordedInExpenses === 'true' || recordedInExpenses === true;
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
        { mileageNumber: { contains: q } },
        { vehicle: { contains: q } },
        { purpose: { contains: q } },
        { notes: { contains: q } },
      ];
    }

    const allowedSortFields = ['date', 'createdAt', 'startMileage', 'endMileage', 'distance'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'date';
    const sortDir = sortOrder.toLowerCase() === 'asc' ? 'asc' : 'desc';

    const [mileages, total] = await Promise.all([
      prisma.mileage.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: [{ [sortField]: sortDir }, { createdAt: 'desc' }],
        include: {
          van: {
            select: { id: true, name: true, vehicle: true },
          },
          expenses: {
            select: { id: true, expenseNumber: true, amount: true, status: true },
          },
        },
      }),
      prisma.mileage.count({ where }),
    ]);

    const formatted = mileages.map((m) => ({
      id: m.id,
      mileageNumber: m.mileageNumber,
      vanId: m.vanId,
      vanName: m.van?.name || null,
      vehicle: m.vehicle || m.van?.vehicle || null,
      date: m.date.toISOString().split('T')[0],
      startMileage: parseFloat(m.startMileage.toString()),
      endMileage: parseFloat(m.endMileage.toString()),
      distance: parseFloat(m.distance.toString()),
      distanceUnit: m.distanceUnit,
      purpose: m.purpose,
      rate: m.rate !== null ? parseFloat(m.rate.toString()) : null,
      estimatedExpense: m.estimatedExpense !== null ? parseFloat(m.estimatedExpense.toString()) : null,
      recordedInExpenses: m.recordedInExpenses,
      expenseId: m.expenses.length > 0 ? m.expenses[0].id : null,
      expenseNumber: m.expenses.length > 0 ? m.expenses[0].expenseNumber : null,
      notes: m.notes,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));

    return res.status(200).json({
      status: 'success',
      data: {
        mileages: formatted,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      },
    });
  } catch (error) {
    console.error('listMileage error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve mileage records.',
    });
  }
}

/**
 * @route   GET /api/v1/mileage/:id
 * @desc    Retrieve detailed mileage record
 * @access  Protected (Admin, Accountant)
 */
export async function getMileageById(req, res) {
  try {
    const { id } = req.params;

    const mileage = await prisma.mileage.findFirst({
      where: { OR: [{ id }, { mileageNumber: id }] },
      include: {
        van: true,
        expenses: true,
      },
    });

    if (!mileage) {
      return res.status(404).json({
        status: 'error',
        code: 'MILEAGE_NOT_FOUND',
        message: `Mileage record '${id}' not found.`,
      });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        id: mileage.id,
        mileageNumber: mileage.mileageNumber,
        vanId: mileage.vanId,
        van: mileage.van,
        vehicle: mileage.vehicle || mileage.van?.vehicle || null,
        date: mileage.date.toISOString().split('T')[0],
        startMileage: parseFloat(mileage.startMileage.toString()),
        endMileage: parseFloat(mileage.endMileage.toString()),
        distance: parseFloat(mileage.distance.toString()),
        distanceUnit: mileage.distanceUnit,
        purpose: mileage.purpose,
        rate: mileage.rate !== null ? parseFloat(mileage.rate.toString()) : null,
        estimatedExpense: mileage.estimatedExpense !== null ? parseFloat(mileage.estimatedExpense.toString()) : null,
        recordedInExpenses: mileage.recordedInExpenses,
        expenses: mileage.expenses.map((e) => ({
          id: e.id,
          expenseNumber: e.expenseNumber,
          category: e.category,
          amount: parseFloat(e.amount.toString()),
          status: e.status,
          date: e.date.toISOString().split('T')[0],
        })),
        notes: mileage.notes,
        createdAt: mileage.createdAt,
        updatedAt: mileage.updatedAt,
      },
    });
  } catch (error) {
    console.error('getMileageById error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve mileage record.',
    });
  }
}

/**
 * @route   POST /api/v1/mileage
 * @desc    Record new vehicle mileage with odometer validation and regression protection
 * @access  Protected (Admin, Accountant)
 */
export async function createMileage(req, res) {
  try {
    const {
      vanId,
      vehicle,
      date,
      startMileage,
      endMileage,
      distanceUnit = 'miles',
      purpose,
      rate,
      notes,
      allowCorrection = false,
    } = req.validatedBody || req.body;

    const dateStr = date || new Date().toISOString().split('T')[0];
    const targetDate = new Date(dateStr);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_DATE',
        message: 'Invalid date provided.',
      });
    }

    const startVal = parseFloat(startMileage);
    const endVal = parseFloat(endMileage);

    if (startVal < 0 || endVal < 0) {
      return res.status(400).json({
        status: 'error',
        code: 'NEGATIVE_MILEAGE_READING',
        message: 'Mileage readings cannot be negative.',
      });
    }

    if (endVal <= startVal) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_ODOMETER_RANGE',
        message: 'Ending mileage must be strictly greater than starting mileage.',
      });
    }

    const distance = round2(endVal - startVal);
    const numericRate = rate !== undefined && rate !== null && rate !== '' ? parseFloat(rate) : null;
    const estimatedExpense = numericRate !== null && !isNaN(numericRate) ? round2(distance * numericRate) : null;

    // Resolve vehicle label and validate van
    let resolvedVehicle = vehicle || null;
    if (vanId) {
      const van = await prisma.van.findUnique({
        where: { id: vanId },
      });
      if (!van) {
        return res.status(404).json({
          status: 'error',
          code: 'VAN_NOT_FOUND',
          message: `Van '${vanId}' not found.`,
        });
      }
      if (!resolvedVehicle) {
        resolvedVehicle = van.vehicle || van.name;
      }

      // Check Odometer Regression against the most recent trip for this van
      const latestTrip = await prisma.mileage.findFirst({
        where: { vanId },
        orderBy: [{ date: 'desc' }, { endMileage: 'desc' }],
      });

      if (latestTrip) {
        const latestEnd = parseFloat(latestTrip.endMileage.toString());
        if (startVal < latestEnd) {
          if (!allowCorrection) {
            return res.status(400).json({
              status: 'error',
              code: 'ODOMETER_REGRESSION_DETECTED',
              message: `Starting mileage (${startVal}) cannot be less than the vehicle's last recorded odometer reading (${latestEnd}). To record an authorized odometer adjustment, provide allowCorrection=true.`,
            });
          }
        }
      }
    }

    const noteWithCorrection = allowCorrection
      ? (notes ? `${notes}\n[Authorized Odometer Adjustment]` : '[Authorized Odometer Adjustment]')
      : notes;

    const year = targetDate.getFullYear();

    const newMileage = await prisma.$transaction(async (tx) => {
      const mileageNumber = await getNextMileageNumber(tx, year);

      return tx.mileage.create({
        data: {
          mileageNumber,
          vanId: vanId || null,
          vehicle: resolvedVehicle,
          date: targetDate,
          startMileage: startVal,
          endMileage: endVal,
          distance,
          distanceUnit,
          purpose,
          rate: numericRate,
          estimatedExpense,
          recordedInExpenses: false,
          notes: noteWithCorrection || null,
        },
        include: {
          van: { select: { id: true, name: true, vehicle: true } },
        },
      });
    });

    return res.status(201).json({
      status: 'success',
      message: `Mileage record ${newMileage.mileageNumber} created successfully.`,
      data: {
        id: newMileage.id,
        mileageNumber: newMileage.mileageNumber,
        vanId: newMileage.vanId,
        vanName: newMileage.van?.name || null,
        vehicle: newMileage.vehicle,
        date: newMileage.date.toISOString().split('T')[0],
        startMileage: parseFloat(newMileage.startMileage.toString()),
        endMileage: parseFloat(newMileage.endMileage.toString()),
        distance: parseFloat(newMileage.distance.toString()),
        distanceUnit: newMileage.distanceUnit,
        purpose: newMileage.purpose,
        rate: newMileage.rate !== null ? parseFloat(newMileage.rate.toString()) : null,
        estimatedExpense: newMileage.estimatedExpense !== null ? parseFloat(newMileage.estimatedExpense.toString()) : null,
        recordedInExpenses: newMileage.recordedInExpenses,
        notes: newMileage.notes,
        createdAt: newMileage.createdAt,
      },
    });
  } catch (error) {
    console.error('createMileage error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to record mileage.',
    });
  }
}

/**
 * @route   PUT /api/v1/mileage/:id
 * @desc    Update mileage entry with safety checks
 * @access  Protected (Admin, Accountant)
 */
export async function updateMileage(req, res) {
  try {
    const { id } = req.params;
    const body = req.validatedBody || req.body;

    const existing = await prisma.mileage.findFirst({
      where: { OR: [{ id }, { mileageNumber: id }] },
      include: { expenses: true },
    });

    if (!existing) {
      return res.status(404).json({
        status: 'error',
        code: 'MILEAGE_NOT_FOUND',
        message: `Mileage record '${id}' not found.`,
      });
    }

    const startVal = body.startMileage !== undefined ? parseFloat(body.startMileage) : parseFloat(existing.startMileage.toString());
    const endVal = body.endMileage !== undefined ? parseFloat(body.endMileage) : parseFloat(existing.endMileage.toString());

    if (startVal < 0 || endVal < 0) {
      return res.status(400).json({
        status: 'error',
        code: 'NEGATIVE_MILEAGE_READING',
        message: 'Mileage readings cannot be negative.',
      });
    }

    if (endVal <= startVal) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_ODOMETER_RANGE',
        message: 'Ending mileage must be strictly greater than starting mileage.',
      });
    }

    const distance = round2(endVal - startVal);
    const numericRate = body.rate !== undefined ? (body.rate !== null && body.rate !== '' ? parseFloat(body.rate) : null) : (existing.rate !== null ? parseFloat(existing.rate.toString()) : null);
    const estimatedExpense = numericRate !== null && !isNaN(numericRate) ? round2(distance * numericRate) : null;

    // If already posted to expenses and values changed, update linked expense atomically
    const updated = await prisma.$transaction(async (tx) => {
      const updateData = {
        startMileage: startVal,
        endMileage: endVal,
        distance,
        rate: numericRate,
        estimatedExpense,
      };

      if (body.vanId !== undefined) updateData.vanId = body.vanId || null;
      if (body.vehicle !== undefined) updateData.vehicle = body.vehicle || null;
      if (body.distanceUnit) updateData.distanceUnit = body.distanceUnit;
      if (body.purpose) updateData.purpose = body.purpose;
      if (body.notes !== undefined) updateData.notes = body.notes;
      if (body.date) {
        const d = new Date(body.date);
        if (!isNaN(d.getTime())) updateData.date = d;
      }

      // Reconcile linked active vehicle expenses if recorded
      if (existing.recordedInExpenses && existing.expenses.length > 0 && estimatedExpense !== null) {
        await tx.vehicleExpense.updateMany({
          where: { mileageId: existing.id, status: 'Recorded' },
          data: {
            amount: estimatedExpense,
            description: `Mileage claim: ${updateData.vehicle || existing.vehicle || 'Van'} (${distance} ${updateData.distanceUnit || existing.distanceUnit} @ £${numericRate?.toFixed(2) || '0.45'}/${updateData.distanceUnit || existing.distanceUnit}) - ${updateData.purpose || existing.purpose}`,
          },
        });
      }

      return tx.mileage.update({
        where: { id: existing.id },
        data: updateData,
        include: { van: true, expenses: true },
      });
    });

    return res.status(200).json({
      status: 'success',
      message: `Mileage record ${updated.mileageNumber} updated successfully.`,
      data: {
        id: updated.id,
        mileageNumber: updated.mileageNumber,
        vanId: updated.vanId,
        vehicle: updated.vehicle,
        date: updated.date.toISOString().split('T')[0],
        startMileage: parseFloat(updated.startMileage.toString()),
        endMileage: parseFloat(updated.endMileage.toString()),
        distance: parseFloat(updated.distance.toString()),
        distanceUnit: updated.distanceUnit,
        purpose: updated.purpose,
        rate: updated.rate !== null ? parseFloat(updated.rate.toString()) : null,
        estimatedExpense: updated.estimatedExpense !== null ? parseFloat(updated.estimatedExpense.toString()) : null,
        recordedInExpenses: updated.recordedInExpenses,
        notes: updated.notes,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error('updateMileage error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to update mileage.',
    });
  }
}

/**
 * @route   DELETE /api/v1/mileage/:id
 * @desc    Safely delete a mileage entry and reconcile linked expenses
 * @access  Protected (Admin only)
 */
export async function deleteMileage(req, res) {
  try {
    const { id } = req.params;

    const mileage = await prisma.mileage.findFirst({
      where: { OR: [{ id }, { mileageNumber: id }] },
      include: { expenses: true },
    });

    if (!mileage) {
      return res.status(404).json({
        status: 'error',
        code: 'MILEAGE_NOT_FOUND',
        message: `Mileage record '${id}' not found.`,
      });
    }

    // Safely delete within a transaction, cascading/cleaning up linked expenses
    await prisma.$transaction(async (tx) => {
      if (mileage.expenses.length > 0) {
        await tx.vehicleExpense.deleteMany({
          where: { mileageId: mileage.id },
        });
      }

      await tx.mileage.delete({
        where: { id: mileage.id },
      });
    });

    return res.status(200).json({
      status: 'success',
      message: `Mileage record ${mileage.mileageNumber} and any linked vehicle expenses removed successfully.`,
    });
  } catch (error) {
    console.error('deleteMileage error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to delete mileage record.',
    });
  }
}

/**
 * @route   POST /api/v1/mileage/:id/post-expense
 * @desc    Post mileage entry directly to vehicle expenses ledger
 * @access  Protected (Admin, Accountant)
 */
export async function postMileageToExpense(req, res) {
  try {
    const { id } = req.params;

    const mileage = await prisma.mileage.findFirst({
      where: { OR: [{ id }, { mileageNumber: id }] },
      include: { van: true },
    });

    if (!mileage) {
      return res.status(404).json({
        status: 'error',
        code: 'MILEAGE_NOT_FOUND',
        message: `Mileage record '${id}' not found.`,
      });
    }

    if (mileage.recordedInExpenses) {
      return res.status(400).json({
        status: 'error',
        code: 'ALREADY_RECORDED_IN_EXPENSES',
        message: 'This mileage record has already been posted to the expenses ledger.',
      });
    }

    const estimatedExpense = mileage.estimatedExpense ? parseFloat(mileage.estimatedExpense.toString()) : null;
    if (!estimatedExpense || estimatedExpense <= 0) {
      return res.status(400).json({
        status: 'error',
        code: 'ZERO_EXPENSE_CLAIM',
        message: 'Mileage entry must have an approved rate and positive estimated expense before posting to ledger.',
      });
    }

    const year = mileage.date.getFullYear();
    const vehicleName = mileage.vehicle || mileage.van?.vehicle || mileage.van?.name || 'Van';

    const result = await prisma.$transaction(async (tx) => {
      const expenseNumber = await getNextExpenseNumber(tx, year);

      const expense = await tx.vehicleExpense.create({
        data: {
          expenseNumber,
          vanId: mileage.vanId || null,
          vehicle: vehicleName,
          mileageId: mileage.id,
          date: mileage.date,
          category: 'Vehicle & Travel',
          description: `Mileage claim: ${vehicleName} (${mileage.distance} ${mileage.distanceUnit} @ £${mileage.rate ? parseFloat(mileage.rate.toString()).toFixed(2) : '0.45'}/${mileage.distanceUnit}) - ${mileage.purpose}`,
          amount: estimatedExpense,
          status: 'Recorded',
          notes: `Generated from Mileage ${mileage.mileageNumber}`,
        },
      });

      const updatedMileage = await tx.mileage.update({
        where: { id: mileage.id },
        data: { recordedInExpenses: true },
      });

      return { expense, updatedMileage };
    });

    return res.status(201).json({
      status: 'success',
      message: `Mileage logged to expenses as ${result.expense.expenseNumber}.`,
      data: {
        expense: {
          id: result.expense.id,
          expenseNumber: result.expense.expenseNumber,
          category: result.expense.category,
          amount: parseFloat(result.expense.amount.toString()),
          status: result.expense.status,
          date: result.expense.date.toISOString().split('T')[0],
        },
        mileage: {
          id: result.updatedMileage.id,
          recordedInExpenses: true,
        },
      },
    });
  } catch (error) {
    console.error('postMileageToExpense error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to post mileage to expense ledger.',
    });
  }
}

// ----------------------------------------------------
// VEHICLE EXPENSES CONTROLLER ACTIONS
// ----------------------------------------------------

/**
 * @route   GET /api/v1/mileage/expenses/list
 * @desc    List vehicle and mileage operational expenses
 * @access  Protected (Admin, Accountant)
 */
export async function listExpenses(req, res) {
  try {
    const {
      page = 1,
      limit = 25,
      search,
      vanId,
      category,
      status,
      startDate,
      endDate,
      sortBy = 'date',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (vanId) where.vanId = vanId;
    if (category) where.category = category;
    if (status) where.status = status;

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
        { expenseNumber: { contains: q } },
        { description: { contains: q } },
        { vehicle: { contains: q } },
        { notes: { contains: q } },
      ];
    }

    const allowedSortFields = ['date', 'amount', 'createdAt', 'category', 'status'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'date';
    const sortDir = sortOrder.toLowerCase() === 'asc' ? 'asc' : 'desc';

    const [expenses, total] = await Promise.all([
      prisma.vehicleExpense.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: [{ [sortField]: sortDir }, { createdAt: 'desc' }],
        include: {
          van: { select: { id: true, name: true, vehicle: true } },
          mileage: { select: { id: true, mileageNumber: true, distance: true, distanceUnit: true } },
        },
      }),
      prisma.vehicleExpense.count({ where }),
    ]);

    const formatted = expenses.map((e) => ({
      id: e.id,
      expenseNumber: e.expenseNumber,
      vanId: e.vanId,
      vanName: e.van?.name || null,
      vehicle: e.vehicle || e.van?.vehicle || null,
      mileageId: e.mileageId,
      mileageNumber: e.mileage?.mileageNumber || null,
      date: e.date.toISOString().split('T')[0],
      category: e.category,
      description: e.description,
      amount: parseFloat(e.amount.toString()),
      status: e.status,
      voidReason: e.voidReason,
      voidedAt: e.voidedAt,
      notes: e.notes,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));

    return res.status(200).json({
      status: 'success',
      data: {
        expenses: formatted,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      },
    });
  } catch (error) {
    console.error('listExpenses error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve vehicle expenses.',
    });
  }
}

/**
 * @route   POST /api/v1/mileage/expenses
 * @desc    Record a new vehicle expense (fuel, maintenance, tolls, etc.)
 * @access  Protected (Admin, Accountant)
 */
export async function createExpense(req, res) {
  try {
    const {
      vanId,
      vehicle,
      mileageId,
      date,
      category,
      description,
      amount,
      notes,
    } = req.validatedBody || req.body;

    const dateStr = date || new Date().toISOString().split('T')[0];
    const targetDate = new Date(dateStr);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_DATE',
        message: 'Invalid date provided.',
      });
    }

    const numericAmount = round2(parseFloat(amount));
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_AMOUNT',
        message: 'Amount must be greater than zero.',
      });
    }

    let resolvedVehicle = vehicle || null;
    if (vanId) {
      const van = await prisma.van.findUnique({
        where: { id: vanId },
      });
      if (!van) {
        return res.status(404).json({
          status: 'error',
          code: 'VAN_NOT_FOUND',
          message: `Van '${vanId}' not found.`,
        });
      }
      if (!resolvedVehicle) {
        resolvedVehicle = van.vehicle || van.name;
      }
    }

    const year = targetDate.getFullYear();

    const created = await prisma.$transaction(async (tx) => {
      const expenseNumber = await getNextExpenseNumber(tx, year);

      return tx.vehicleExpense.create({
        data: {
          expenseNumber,
          vanId: vanId || null,
          vehicle: resolvedVehicle,
          mileageId: mileageId || null,
          date: targetDate,
          category,
          description,
          amount: numericAmount,
          status: 'Recorded',
          notes: notes || null,
        },
        include: {
          van: { select: { id: true, name: true } },
        },
      });
    });

    return res.status(201).json({
      status: 'success',
      message: `Expense ${created.expenseNumber} created successfully.`,
      data: {
        id: created.id,
        expenseNumber: created.expenseNumber,
        vanId: created.vanId,
        vanName: created.van?.name || null,
        vehicle: created.vehicle,
        date: created.date.toISOString().split('T')[0],
        category: created.category,
        description: created.description,
        amount: parseFloat(created.amount.toString()),
        status: created.status,
        notes: created.notes,
        createdAt: created.createdAt,
      },
    });
  } catch (error) {
    console.error('createExpense error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to create vehicle expense.',
    });
  }
}

/**
 * @route   POST /api/v1/mileage/expenses/:id/void
 * @desc    Safely void a vehicle expense while preserving historical audit record
 * @access  Protected (Admin, Accountant)
 */
export async function voidExpense(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.validatedBody || req.body;

    const expense = await prisma.vehicleExpense.findFirst({
      where: { OR: [{ id }, { expenseNumber: id }] },
    });

    if (!expense) {
      return res.status(404).json({
        status: 'error',
        code: 'EXPENSE_NOT_FOUND',
        message: `Expense '${id}' not found.`,
      });
    }

    if (expense.status === 'Void') {
      return res.status(400).json({
        status: 'error',
        code: 'ALREADY_VOIDED',
        message: 'This expense is already voided.',
      });
    }

    const voided = await prisma.$transaction(async (tx) => {
      const updatedExpense = await tx.vehicleExpense.update({
        where: { id: expense.id },
        data: {
          status: 'Void',
          voidReason: reason,
          voidedAt: new Date(),
        },
      });

      // If linked to mileage, release the mileage record so it can be re-logged or edited
      if (expense.mileageId) {
        await tx.mileage.update({
          where: { id: expense.mileageId },
          data: { recordedInExpenses: false },
        });
      }

      return updatedExpense;
    });

    return res.status(200).json({
      status: 'success',
      message: `Expense ${voided.expenseNumber} has been voided.`,
      data: {
        id: voided.id,
        expenseNumber: voided.expenseNumber,
        status: voided.status,
        voidReason: voided.voidReason,
        voidedAt: voided.voidedAt,
      },
    });
  } catch (error) {
    console.error('voidExpense error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to void vehicle expense.',
    });
  }
}
