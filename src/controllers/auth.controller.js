import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../config/db.js';
import { generateToken, verifyToken, authCookieOptions } from '../utils/token.js';
import { getEffectivePermissions } from '../utils/permissions.js';
import { logAuditEvent } from '../utils/auditLogger.js';
import { sendPasswordResetEmail } from '../services/email.service.js';

export const loginSchema = z.object({
  email: z.string().trim().email('A valid email address is required.'),
  password: z.string().min(1, 'Password is required.'),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(255),
  email: z.string().trim().email('A valid email address is required.').max(255),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  invitationToken: z.string().trim().optional().nullable(),
  customerId: z.string().trim().max(50).optional().nullable(),
  verificationSecret: z.string().trim().max(100).optional().nullable(),
  acceptTerms: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('A valid email address is required.').max(255),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20, 'Password reset token is required.'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters.').max(100),
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

    const effectivePermissions = getEffectivePermissions(user);

    // Evaluate Terms & Conditions acceptance for customer portal users
    let termsAcceptance = {
      required: false,
      hasAccepted: true,
      currentVersion: null,
    };

    if (user.role === 'customer') {
      const activeTerms = await prisma.termsVersion.findFirst({
        where: { status: 'published', requiresReacceptance: true },
        orderBy: { publishedAt: 'desc' },
      });

      if (activeTerms) {
        termsAcceptance.required = true;
        termsAcceptance.currentVersion = activeTerms.version;
        const acceptance = await prisma.customerTermsAcceptance.findUnique({
          where: {
            userId_termsVersionId: {
              userId: user.id,
              termsVersionId: activeTerms.id,
            },
          },
        });
        termsAcceptance.hasAccepted = !!acceptance;
      }
    }

    // Sanitized user profile (never expose passwordHash)
    const sanitizedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      title: user.title,
      permissions: user.permissions || null,
      effectivePermissions,
      customerId: user.customerId,
      customer: user.customer,
      lastLoginAt: new Date(),
      termsAcceptance,
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
  let termsAcceptance = {
    required: false,
    hasAccepted: true,
    currentVersion: null,
  };

  if (req.user?.role === 'customer') {
    const activeTerms = await prisma.termsVersion.findFirst({
      where: { status: 'published', requiresReacceptance: true },
      orderBy: { publishedAt: 'desc' },
    });

    if (activeTerms) {
      termsAcceptance.required = true;
      termsAcceptance.currentVersion = activeTerms.version;
      const acceptance = await prisma.customerTermsAcceptance.findUnique({
        where: {
          userId_termsVersionId: {
            userId: req.user.id,
            termsVersionId: activeTerms.id,
          },
        },
      });
      termsAcceptance.hasAccepted = !!acceptance;
    }
  }

  return res.status(200).json({
    status: 'ok',
    user: {
      ...req.user,
      termsAcceptance,
    },
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

/**
 * @route   POST /api/v1/auth/register
 * @desc    Secure customer self-registration with verified account linking
 * @access  Public
 */
export async function register(req, res) {
  const { name, email, password, invitationToken, customerId, verificationSecret } = req.validatedBody;
  const normalizedEmail = email.toLowerCase().trim();

  try {
    // 1. Anti-enumeration check: duplicate email
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      return res.status(409).json({
        status: 'error',
        code: 'REGISTRATION_FAILED',
        message: 'Unable to complete registration. If you already have an account, please sign in.',
      });
    }

    // Find active published Terms & Conditions if configured
    const activeTerms = await prisma.termsVersion.findFirst({
      where: { status: 'published' },
      orderBy: { publishedAt: 'desc' },
    });

    let targetCustomer = null;
    let newUser = null;
    let consumedInvitationId = null;

    // 2. Verification Method A: Single-Use Cryptographic Invitation Token
    if (invitationToken && invitationToken.trim() !== '') {
      const cleanToken = invitationToken.trim();
      const decoded = verifyToken(cleanToken);
      if (!decoded || decoded.type !== 'portal_invitation' || !decoded.customerId) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_INVITATION',
          message: 'The invitation token is invalid or has expired. Please contact an administrator.',
        });
      }

      const tokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');

      targetCustomer = await prisma.customer.findUnique({
        where: { id: decoded.customerId },
      });

      if (!targetCustomer || targetCustomer.status !== 'Active') {
        return res.status(400).json({
          status: 'error',
          code: 'CUSTOMER_INACTIVE',
          message: 'The associated customer account was not found or is currently inactive.',
        });
      }

      // Mandatory Terms & Conditions acceptance verification
      if (activeTerms && req.validatedBody.acceptTerms !== true) {
        return res.status(400).json({
          status: 'error',
          code: 'TERMS_ACCEPTANCE_REQUIRED',
          message: 'You must review and accept the Customer Terms & Conditions to complete registration.',
          termsVersion: {
            id: activeTerms.id,
            version: activeTerms.version,
            title: activeTerms.title,
          },
        });
      }

      // Hash password with bcrypt (12 rounds)
      const passwordHash = await bcrypt.hash(password, 12);

      // ATOMIC TRANSACTION: Single-use verification, user creation & token status transition
      const txResult = await prisma.$transaction(async (tx) => {
        // Query persistent invitation record by hash
        const invitation = await tx.customerInvitation.findUnique({
          where: { tokenHash },
        });

        if (!invitation) {
          // Rejection of legacy stateless tokens or non-existent tokens
          const err = new Error('The invitation token is invalid, has expired, or was superseded. Please request a new invitation from an administrator.');
          err.status = 400;
          err.code = 'INVALID_INVITATION';
          throw err;
        }

        if (invitation.status === 'revoked') {
          const err = new Error('This invitation has been revoked by an administrator. Please contact your account manager.');
          err.status = 400;
          err.code = 'INVITATION_REVOKED';
          throw err;
        }

        if (invitation.status === 'consumed') {
          const err = new Error('This invitation has already been used to register an account. Please sign in.');
          err.status = 400;
          err.code = 'INVITATION_ALREADY_USED';
          throw err;
        }

        if (invitation.status !== 'pending' || new Date(invitation.expiresAt) < new Date()) {
          const err = new Error('This invitation has expired. Please request a new invitation from an administrator.');
          err.status = 400;
          err.code = 'INVITATION_EXPIRED';
          throw err;
        }

        if (invitation.customerId !== targetCustomer.id) {
          const err = new Error('The invitation does not match the associated customer record.');
          err.status = 400;
          err.code = 'INVALID_INVITATION';
          throw err;
        }

        // Create new Customer Portal user (role and permissions strictly enforced server-side)
        const createdUser = await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            role: 'customer',
            name: name.trim(),
            title: 'Customer Client',
            customerId: targetCustomer.id,
            permissions: [],
            isActive: true,
          },
          include: {
            customer: {
              select: {
                id: true,
                name: true,
                contactPerson: true,
                email: true,
                status: true,
              },
            },
          },
        });

        // Atomic conditional transition: Only update if status is still 'pending'
        const updateResult = await tx.customerInvitation.updateMany({
          where: {
            id: invitation.id,
            status: 'pending',
          },
          data: {
            status: 'consumed',
            consumedAt: new Date(),
            consumedByUserId: createdUser.id,
          },
        });

        if (updateResult.count === 0) {
          // Concurrent race condition lost
          const err = new Error('This invitation has already been used to register an account.');
          err.status = 400;
          err.code = 'INVITATION_ALREADY_USED';
          throw err;
        }

        // Record Terms & Conditions acceptance atomically
        if (activeTerms) {
          const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
          const userAgent = (req.headers['user-agent'] || '').slice(0, 255) || null;
          await tx.customerTermsAcceptance.create({
            data: {
              termsVersionId: activeTerms.id,
              customerId: targetCustomer.id,
              userId: createdUser.id,
              versionString: activeTerms.version,
              acceptanceMethod: 'registration',
              ipAddress: typeof clientIp === 'string' ? clientIp.slice(0, 45) : null,
              userAgent,
            },
          });
        }

        return { user: createdUser, invitationId: invitation.id };
      });

      newUser = txResult.user;
      consumedInvitationId = txResult.invitationId;
    } else {
      return res.status(400).json({
        status: 'error',
        code: 'INVITATION_REQUIRED',
        message: 'A valid administrator invitation is required to register a customer portal account. Please contact an administrator to receive an invitation link.',
      });
    }

    // 3. Record security audit log (tokens and secrets are strictly excluded)
    await logAuditEvent({
      action: 'CUSTOMER_SELF_REGISTERED',
      entityType: 'User',
      entityId: newUser.id,
      userId: newUser.id,
      userEmail: newUser.email,
      userRole: newUser.role,
      details: {
        customerId: targetCustomer.id,
        customerName: targetCustomer.name,
        verificationMethod: 'invitation_token',
        invitationId: consumedInvitationId || null,
        termsVersion: activeTerms ? activeTerms.version : null,
      },
      req,
    });

    // 5. Issue session token and cookie
    const token = generateToken({
      userId: newUser.id,
      role: newUser.role,
      customerId: newUser.customerId,
    });

    res.cookie('token', token, authCookieOptions);

    const sanitizedUser = {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      title: newUser.title,
      permissions: [],
      effectivePermissions: [],
      customerId: newUser.customerId,
      customer: newUser.customer,
      lastLoginAt: newUser.createdAt,
      termsAcceptance: {
        required: !!activeTerms,
        hasAccepted: !!activeTerms,
        currentVersion: activeTerms ? activeTerms.version : null,
      },
    };

    return res.status(201).json({
      status: 'ok',
      message: 'Registration successful. Welcome to your B3 Invoices customer portal!',
      user: sanitizedUser,
      token,
    });
  } catch (error) {
    if (error.status && error.code) {
      return res.status(error.status).json({
        status: 'error',
        code: error.code,
        message: error.message,
      });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({
        status: 'error',
        code: 'REGISTRATION_FAILED',
        message: 'Unable to complete registration. If you already have an account, please sign in.',
      });
    }

    console.error('Registration error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'An error occurred during account registration. Please try again later.',
    });
  }
}

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Request a secure password reset link (anti-enumeration protected)
 * @access  Public
 */
export async function forgotPassword(req, res) {
  const { email } = req.validatedBody;
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Anti-enumeration: Return the same generic success response whether user exists or not
    const genericResponse = {
      status: 'ok',
      message: 'If an account exists with that email address, a password reset link has been dispatched.',
    };

    if (!user || !user.isActive) {
      return res.status(200).json(genericResponse);
    }

    // Generate high-entropy 32-byte cryptographically secure token (64 hex characters)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 60 minutes expiry

    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    const userAgent = (req.headers['user-agent'] || '').slice(0, 255) || null;

    // Invalidate any existing pending reset tokens for this user
    await prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        status: 'pending',
      },
      data: { status: 'revoked' },
    });

    // Store token SHA-256 hash (never raw token)
    await prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        status: 'pending',
        expiresAt,
        ipAddress: typeof clientIp === 'string' ? clientIp.slice(0, 45) : null,
        userAgent,
      },
    });

    await logAuditEvent({
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      details: { email: user.email, expiresAt: expiresAt.toISOString() },
      req,
    });

    // Outbound email dispatch via Resend
    try {
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetToken: rawToken,
      });
      console.log(`[Auth] Password reset email successfully dispatched to ${user.email}.`);
    } catch (emailError) {
      if (emailError.code === 'MISSING_API_KEY') {
        console.error('[Auth] Password reset email skipped: RESEND_API_KEY is not configured.');
        return res.status(500).json({
          status: 'error',
          code: 'EMAIL_CONFIG_MISSING',
          message: 'Email service is not configured. Please contact an administrator.',
        });
      }

      console.error(`[Auth] Failed to send password reset email to ${user.email}: ${emailError.message}`);
      return res.status(502).json({
        status: 'error',
        code: 'EMAIL_DELIVERY_FAILED',
        message: 'Unable to deliver password reset email. Please try again later or contact an administrator.',
      });
    }

    // Return generic success response (raw token is never exposed in HTTP response)
    return res.status(200).json(genericResponse);
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'An error occurred while processing your request. Please try again later.',
    });
  }
}

/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Reset password using single-use secure reset token
 * @access  Public
 */
export async function resetPassword(req, res) {
  const { token, newPassword } = req.validatedBody;
  const cleanToken = token.trim();

  try {
    const tokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');

    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!resetRecord) {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'The password reset link is invalid or has expired. Please request a new one.',
      });
    }

    if (resetRecord.status === 'used') {
      return res.status(400).json({
        status: 'error',
        code: 'TOKEN_ALREADY_USED',
        message: 'This password reset link has already been used. Please request a new one.',
      });
    }

    if (resetRecord.status !== 'pending' || new Date(resetRecord.expiresAt) < new Date()) {
      return res.status(400).json({
        status: 'error',
        code: 'TOKEN_EXPIRED',
        message: 'This password reset link has expired. Please request a new one.',
      });
    }

    if (!resetRecord.user || !resetRecord.user.isActive) {
      return res.status(400).json({
        status: 'error',
        code: 'ACCOUNT_DISABLED',
        message: 'The associated user account is inactive or disabled. Please contact an administrator.',
      });
    }

    // Hash new password using bcrypt (12 rounds)
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Atomic transaction: update password, mark token as used, revoke any other pending tokens
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash },
      });

      await tx.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: {
          status: 'used',
          usedAt: new Date(),
        },
      });

      await tx.passwordResetToken.updateMany({
        where: {
          userId: resetRecord.userId,
          status: 'pending',
          id: { not: resetRecord.id },
        },
        data: { status: 'revoked' },
      });
    });

    await logAuditEvent({
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: resetRecord.userId,
      userId: resetRecord.userId,
      userEmail: resetRecord.user.email,
      userRole: resetRecord.user.role,
      details: { email: resetRecord.user.email },
      req,
    });

    return res.status(200).json({
      status: 'ok',
      message: 'Your password has been successfully reset. You may now sign in with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'An error occurred while resetting your password. Please try again later.',
    });
  }
}
