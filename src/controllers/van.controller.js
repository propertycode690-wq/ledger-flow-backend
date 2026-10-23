import { z } from 'zod';
import prisma from '../config/db.js';

export const createVanSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'Van ID is required.')
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Van ID can only contain letters, numbers, underscores, and dashes.'),
  name: z.string().trim().min(1, 'Van name is required.').max(100),
  vehicle: z.string().trim().max(150).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const updateVanSchema = z.object({
  name: z.string().trim().min(1, 'Van name cannot be empty.').max(100).optional(),
  vehicle: z.string().trim().max(150).optional().nullable(),
  isActive: z.boolean().optional(),
});

/**
 * @route   GET /api/v1/vans
 * @desc    List delivery vans with customer counts
 * @access  Protected (Admin, Accountant, Customer)
 */
export async function listVans(req, res) {
  try {
    const { includeInactive } = req.query;

    const where = {};
    if (includeInactive !== 'true') {
      where.isActive = true;
    }

    const vans = await prisma.van.findMany({
      where,
      include: {
        _count: {
          select: { customers: true },
        },
      },
      orderBy: { id: 'asc' },
    });

    const formattedVans = vans.map((v) => ({
      id: v.id,
      name: v.name,
      vehicle: v.vehicle,
      isActive: v.isActive,
      customerCount: v._count.customers,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    }));

    return res.status(200).json({
      status: 'ok',
      total: formattedVans.length,
      data: formattedVans,
    });
  } catch (error) {
    console.error('List vans error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve delivery vans.',
    });
  }
}

/**
 * @route   GET /api/v1/vans/:id
 * @desc    Get single van details by ID
 * @access  Protected (Admin, Accountant, Customer)
 */
export async function getVanById(req, res) {
  try {
    const { id } = req.params;

    const van = await prisma.van.findUnique({
      where: { id },
      include: {
        customers: {
          select: {
            id: true,
            name: true,
            contactPerson: true,
            phone: true,
            status: true,
          },
        },
      },
    });

    if (!van) {
      return res.status(404).json({
        status: 'error',
        code: 'VAN_NOT_FOUND',
        message: `Delivery van with ID '${id}' was not found.`,
      });
    }

    return res.status(200).json({
      status: 'ok',
      data: van,
    });
  } catch (error) {
    console.error('Get van error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve van details.',
    });
  }
}

/**
 * @route   POST /api/v1/vans
 * @desc    Create a new delivery route van
 * @access  Protected (Admin only)
 */
export async function createVan(req, res) {
  try {
    const data = req.validatedBody;

    const existing = await prisma.van.findUnique({
      where: { id: data.id },
    });

    if (existing) {
      return res.status(409).json({
        status: 'error',
        code: 'DUPLICATE_VAN_ID',
        message: `A van with ID '${data.id}' already exists.`,
      });
    }

    const van = await prisma.van.create({
      data: {
        id: data.id,
        name: data.name,
        vehicle: data.vehicle || null,
        isActive: data.isActive !== undefined ? data.isActive : true,
      },
    });

    return res.status(201).json({
      status: 'ok',
      message: `Van '${van.name}' created successfully.`,
      data: van,
    });
  } catch (error) {
    console.error('Create van error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to create delivery van.',
    });
  }
}

/**
 * @route   PUT /api/v1/vans/:id
 * @desc    Update van details
 * @access  Protected (Admin only)
 */
export async function updateVan(req, res) {
  try {
    const { id } = req.params;
    const data = req.validatedBody;

    const existing = await prisma.van.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        status: 'error',
        code: 'VAN_NOT_FOUND',
        message: `Delivery van with ID '${id}' was not found.`,
      });
    }

    const updated = await prisma.van.update({
      where: { id },
      data,
    });

    return res.status(200).json({
      status: 'ok',
      message: `Van '${updated.name}' updated successfully.`,
      data: updated,
    });
  } catch (error) {
    console.error('Update van error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to update delivery van.',
    });
  }
}

/**
 * @route   DELETE /api/v1/vans/:id
 * @desc    Safely remove or deactivate van
 * @access  Protected (Admin only)
 */
export async function deleteVan(req, res) {
  try {
    const { id } = req.params;

    const van = await prisma.van.findUnique({
      where: { id },
      include: {
        _count: {
          select: { customers: true },
        },
      },
    });

    if (!van) {
      return res.status(404).json({
        status: 'error',
        code: 'VAN_NOT_FOUND',
        message: `Delivery van with ID '${id}' was not found.`,
      });
    }

    // Safety policy: Cannot hard delete if customers are assigned to this van
    if (van._count.customers > 0) {
      return res.status(409).json({
        status: 'error',
        code: 'VAN_HAS_ASSIGNED_CUSTOMERS',
        message: `Cannot delete van '${van.name}' because ${van._count.customers} customer(s) are currently assigned to this delivery route. Reassign customers or deactivate the van instead.`,
      });
    }

    await prisma.van.delete({
      where: { id },
    });

    return res.status(200).json({
      status: 'ok',
      message: `Van '${van.name}' deleted successfully.`,
    });
  } catch (error) {
    console.error('Delete van error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to delete delivery van.',
    });
  }
}
