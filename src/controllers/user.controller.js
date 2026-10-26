import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../config/db.js';
import {
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  getEffectivePermissions,
} from '../utils/permissions.js';

export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(255),
  email: z.string().trim().email('Valid email address is required.').max(255),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  role: z.enum(['admin', 'accountant', 'customer'], {
    errorMap: () => ({ message: "Role must be 'admin', 'accountant', or 'customer'." }),
  }),
  title: z.string().trim().max(100).optional().nullable(),
  customerId: z.string().trim().max(50).optional().nullable(),
  permissions: z.array(z.string()).optional(),
  isActive: z.boolean().optional().default(true),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(255).optional(),
  email: z.string().trim().email('Valid email address is required.').max(255).optional(),
  password: z.string().min(6, 'Password must be at least 6 characters.').optional().nullable(),
  role: z.enum(['admin', 'accountant', 'customer']).optional(),
  title: z.string().trim().max(100).optional().nullable(),
  customerId: z.string().trim().max(50).optional().nullable(),
  permissions: z.array(z.string()).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const toggleStatusSchema = z.object({
  isActive: z.boolean({ required_error: 'isActive boolean flag is required.' }),
});

/**
 * Sanitize user object for API responses (strips passwordHash)
 */
function sanitizeUser(user) {
  if (!user) return null;
  const effectivePermissions = getEffectivePermissions(user);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    title: user.title,
    customerId: user.customerId,
    customer: user.customer || null,
    isActive: user.isActive,
    permissions: user.permissions || null,
    effectivePermissions,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * @route   GET /api/v1/users
 * @desc    List all system users with their roles and effective permissions
 * @access  Protected (Admin only)
 */
export async function listUsers(req, res) {
  try {
    const users = await prisma.user.findMany({
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({
      status: 'ok',
      data: users.map(sanitizeUser),
    });
  } catch (error) {
    console.error('Error listing users:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve user accounts.',
    });
  }
}

/**
 * @route   GET /api/v1/users/:id
 * @desc    Get user profile by ID
 * @access  Protected (Admin only)
 */
export async function getUserById(req, res) {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        status: 'error',
        code: 'USER_NOT_FOUND',
        message: `User '${id}' not found.`,
      });
    }

    return res.status(200).json({
      status: 'ok',
      data: sanitizeUser(user),
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve user profile.',
    });
  }
}

/**
 * @route   POST /api/v1/users
 * @desc    Create a new system user with assigned role and granular permissions
 * @access  Protected (Admin only)
 */
export async function createUser(req, res) {
  try {
    const { name, email, password, role, title, customerId, permissions, isActive } = req.validatedBody;
    const normalizedEmail = email.toLowerCase().trim();

    // Check duplicate email
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      return res.status(409).json({
        status: 'error',
        code: 'EMAIL_ALREADY_EXISTS',
        message: `A user account with email '${normalizedEmail}' already exists.`,
      });
    }

    // Verify customer linkage if customer role
    if (role === 'customer' && customerId) {
      const customer = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!customer) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_CUSTOMER',
          message: `Linked customer account '${customerId}' does not exist.`,
        });
      }
    }

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 12);

    // Sanitize permissions
    let finalPermissions = null;
    if (Array.isArray(permissions)) {
      finalPermissions = permissions.filter(
        (p) => ALL_PERMISSIONS.includes(p) && (role === 'admin' || p !== PERMISSIONS.USERS_MANAGE)
      );
    } else {
      // Apply secure role defaults
      if (role === 'accountant') {
        finalPermissions = [...DEFAULT_ROLE_PERMISSIONS.accountant];
      } else if (role === 'admin') {
        finalPermissions = [...DEFAULT_ROLE_PERMISSIONS.admin];
      } else {
        finalPermissions = [];
      }
    }

    const created = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        role,
        name: name.trim(),
        title: title?.trim() || (role === 'admin' ? 'Administrator' : role === 'accountant' ? 'Accountant' : 'Customer Client'),
        customerId: role === 'customer' ? customerId : null,
        permissions: finalPermissions,
        isActive: isActive !== undefined ? isActive : true,
      },
      include: {
        customer: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return res.status(201).json({
      status: 'ok',
      message: 'User account created successfully.',
      data: sanitizeUser(created),
    });
  } catch (error) {
    console.error('Error creating user:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to create user account.',
    });
  }
}

/**
 * @route   PUT /api/v1/users/:id
 * @desc    Update an existing user's details, role, or granular permissions
 * @access  Protected (Admin only)
 */
export async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { name, email, password, role, title, customerId, permissions, isActive } = req.validatedBody;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({
        status: 'error',
        code: 'USER_NOT_FOUND',
        message: `User '${id}' not found.`,
      });
    }

    const updateData = {};

    if (name !== undefined) updateData.name = name.trim();
    if (title !== undefined) updateData.title = title ? title.trim() : null;

    if (email !== undefined) {
      const normalizedEmail = email.toLowerCase().trim();
      if (normalizedEmail !== existing.email) {
        const emailConflict = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (emailConflict) {
          return res.status(409).json({
            status: 'error',
            code: 'EMAIL_ALREADY_EXISTS',
            message: `Email '${normalizedEmail}' is already registered to another user.`,
          });
        }
        updateData.email = normalizedEmail;
      }
    }

    if (password && password.trim().length >= 6) {
      updateData.passwordHash = await bcrypt.hash(password.trim(), 12);
    }

    if (role !== undefined) {
      updateData.role = role;
      if (role !== 'customer') {
        updateData.customerId = null;
      }
    }

    if (customerId !== undefined && (role === 'customer' || existing.role === 'customer')) {
      updateData.customerId = customerId || null;
    }

    const targetRole = role || existing.role;

    if (permissions !== undefined) {
      if (permissions === null) {
        updateData.permissions = null;
      } else if (Array.isArray(permissions)) {
        updateData.permissions = permissions.filter(
          (p) => ALL_PERMISSIONS.includes(p) && (targetRole === 'admin' || p !== PERMISSIONS.USERS_MANAGE)
        );
      }
    }

    if (isActive !== undefined) {
      // Safety rule: Admin cannot deactivate their own active account
      if (!isActive && req.user.id === id) {
        return res.status(400).json({
          status: 'error',
          code: 'CANNOT_DEACTIVATE_SELF',
          message: 'You cannot deactivate your own administrative account.',
        });
      }
      updateData.isActive = isActive;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      include: {
        customer: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return res.status(200).json({
      status: 'ok',
      message: 'User account updated successfully.',
      data: sanitizeUser(updated),
    });
  } catch (error) {
    console.error('Error updating user:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to update user profile.',
    });
  }
}

/**
 * @route   PATCH /api/v1/users/:id/status
 * @desc    Safely activate or deactivate a user account
 * @access  Protected (Admin only)
 */
export async function toggleUserStatus(req, res) {
  try {
    const { id } = req.params;
    const { isActive } = req.validatedBody;

    // Safety rule: Admin cannot deactivate their own active account
    if (!isActive && req.user.id === id) {
      return res.status(400).json({
        status: 'error',
        code: 'CANNOT_DEACTIVATE_SELF',
        message: 'You cannot deactivate your own administrative account.',
      });
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({
        status: 'error',
        code: 'USER_NOT_FOUND',
        message: `User '${id}' not found.`,
      });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive },
      include: {
        customer: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return res.status(200).json({
      status: 'ok',
      message: `User account ${isActive ? 'activated' : 'deactivated'} successfully.`,
      data: sanitizeUser(updated),
    });
  } catch (error) {
    console.error('Error toggling user status:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to update user status.',
    });
  }
}

/**
 * @route   GET /api/v1/users/permissions/catalog
 * @desc    Retrieve the permission taxonomy and default presets
 * @access  Protected (Admin & Accountant)
 */
export function getCatalog(req, res) {
  return res.status(200).json({
    status: 'ok',
    data: {
      catalog: PERMISSION_CATALOG,
      allPermissions: ALL_PERMISSIONS,
      defaultRolePermissions: DEFAULT_ROLE_PERMISSIONS,
    },
  });
}
