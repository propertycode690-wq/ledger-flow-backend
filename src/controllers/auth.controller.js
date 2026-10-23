import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../config/db.js';
import { generateToken, authCookieOptions } from '../utils/token.js';

export const loginSchema = z.object({
  email: z.string().trim().email('A valid email address is required.'),
  password: z.string().min(1, 'Password is required.'),
});

/**
 * @route   POST /api/v1/auth/login
 * @desc    Authenticate user credentials, set HTTP-only cookie, and issue JWT
 * @access  Public
 */
export async function login(req, res) {
  const { email, password } = req.validatedBody;
  const normalizedEmail = email.toLowerCase();

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
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
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        status: 'error',
        code: 'ACCOUNT_DEACTIVATED',
        message: 'Account is deactivated. Please contact an administrator.',
      });
    }

    // Verify bcrypt password hash
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({
        status: 'error',
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
    }

    // Update last login timestamp asynchronously
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Generate token
    const token = generateToken({
      userId: user.id,
      role: user.role,
      customerId: user.customerId,
    });

    // Set secure HTTP-only cookie
    res.cookie('token', token, authCookieOptions);

    // Sanitized user profile (never expose passwordHash)
    const sanitizedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      title: user.title,
      customerId: user.customerId,
      customer: user.customer,
      lastLoginAt: new Date(),
    };

    return res.status(200).json({
      status: 'ok',
      message: 'Login successful.',
      user: sanitizedUser,
      token, // Also return in body for clients preferring Authorization header
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'An error occurred during authentication.',
    });
  }
}

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get currently authenticated user session profile
 * @access  Protected
 */
export async function me(req, res) {
  return res.status(200).json({
    status: 'ok',
    user: req.user,
  });
}

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Clear session cookie and invalidate active session
 * @access  Protected
 */
export async function logout(req, res) {
  res.clearCookie('token', {
    ...authCookieOptions,
    maxAge: 0,
  });

  return res.status(200).json({
    status: 'ok',
    message: 'Logged out successfully.',
  });
}
