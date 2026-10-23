import { verifyToken } from '../utils/token.js';
import prisma from '../config/db.js';

/**
 * Require authentication middleware.
 * Reads token from HTTP-only cookie or Authorization: Bearer <token> header.
 */
export async function requireAuth(req, res, next) {
  let token = null;

  // 1. Try reading from cookie
  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }
  // 2. Fallback to Authorization Bearer header
  else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      status: 'error',
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Please log in.',
    });
  }

  const decoded = verifyToken(token);
  if (!decoded || !decoded.userId) {
    return res.status(401).json({
      status: 'error',
      code: 'INVALID_TOKEN',
      message: 'Session invalid or expired. Please log in again.',
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            contactPerson: true,
            email: true,
            vanId: true,
            status: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(401).json({
        status: 'error',
        code: 'USER_NOT_FOUND',
        message: 'The user account associated with this session no longer exists.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        status: 'error',
        code: 'ACCOUNT_DEACTIVATED',
        message: 'This account has been deactivated. Please contact an administrator.',
      });
    }

    // Attach sanitized user to request (omit passwordHash)
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      title: user.title,
      customerId: user.customerId,
      customer: user.customer,
      lastLoginAt: user.lastLoginAt,
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'An error occurred while validating your session.',
    });
  }
}

/**
 * Enforce server-side Role-Based Access Control (RBAC).
 * @param {string[]} allowedRoles Array of allowed role names (e.g. ['admin', 'accountant'])
 */
export function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        status: 'error',
        code: 'FORBIDDEN',
        message: `Forbidden: Access restricted to roles [${allowedRoles.join(', ')}]. Your active role is '${req.user.role}'.`,
      });
    }

    next();
  };
}

/**
 * Enforce customer account isolation.
 * Prevents a customer from passing another customerId in params, query, or body.
 */
export function enforceCustomerScope(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ status: 'error', message: 'Authentication required.' });
  }

  // Admins and accountants have organization-wide visibility
  if (req.user.role === 'admin' || req.user.role === 'accountant') {
    return next();
  }

  // Customer role must have customerId and cannot query other customer accounts
  if (req.user.role === 'customer') {
    if (!req.user.customerId) {
      return res.status(403).json({
        status: 'error',
        code: 'NO_CUSTOMER_LINK',
        message: 'Customer account not properly linked to a client record.',
      });
    }

    // Check customerId in query, params, or body
    const requestedCustomerId = req.params.customerId || req.query.customerId || req.body.customerId;
    if (requestedCustomerId && requestedCustomerId !== req.user.customerId) {
      return res.status(403).json({
        status: 'error',
        code: 'CUSTOMER_ISOLATION_VIOLATION',
        message: 'Forbidden: You cannot access or modify records of another customer account.',
      });
    }
  }

  next();
}
