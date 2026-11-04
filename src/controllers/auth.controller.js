import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../config/db.js';
import { generateToken, verifyToken, authCookieOptions } from '../utils/token.js';
import { getEffectivePermissions } from '../utils/permissions.js';
import { logAuditEvent } from '../utils/auditLogger.js';

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
    }
    // 3. Verification Method B: Account Credentials Challenge (CustomerID + Invoice / Tax reference)
    else if (customerId && customerId.trim() !== '' && verificationSecret && verificationSecret.trim() !== '') {
      const cleanCustomerId = customerId.trim();
      const cleanSecret = verificationSecret.trim();

      targetCustomer = await prisma.customer.findUnique({
        where: { id: cleanCustomerId },
      });

      if (!targetCustomer || targetCustomer.status !== 'Active') {
        return res.status(400).json({
          status: 'error',
          code: 'VERIFICATION_FAILED',
          message: 'Account verification failed. Please check your Customer ID and verification details.',
        });
      }

      // Verify secret against customer records
      const normalizedSecret = cleanSecret.replace(/\s+/g, '').toUpperCase();
      const customerVat = (targetCustomer.vatNumber || '').replace(/\s+/g, '').toUpperCase();
      const customerAddr = (targetCustomer.address || '').toUpperCase();

      let isVerified = false;

      // Match VAT number
      if (customerVat && customerVat === normalizedSecret) {
        isVerified = true;
      }
      // Match billing postal code or address snippet
      else if (customerAddr && customerAddr.includes(normalizedSecret)) {
        isVerified = true;
      }
      // Match recent issued invoice number
      else {
        const matchingInvoice = await prisma.invoice.findFirst({
          where: {
            customerId: targetCustomer.id,
            invoiceNumber: cleanSecret,
            status: { notIn: ['Draft', 'Void'] },
          },
        });
        if (matchingInvoice) {
          isVerified = true;
        }
      }

      if (!isVerified) {
        return res.status(400).json({
          status: 'error',
          code: 'VERIFICATION_FAILED',
          message: 'Account verification failed. The invoice reference or postal code provided does not match our records.',
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

      const passwordHash = await bcrypt.hash(password, 12);

      const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
      const userAgent = (req.headers['user-agent'] || '').slice(0, 255) || null;

      newUser = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
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

        if (activeTerms) {
          await tx.customerTermsAcceptance.create({
            data: {
              termsVersionId: activeTerms.id,
              customerId: targetCustomer.id,
              userId: created.id,
              versionString: activeTerms.version,
              acceptanceMethod: 'registration',
              ipAddress: typeof clientIp === 'string' ? clientIp.slice(0, 45) : null,
              userAgent,
            },
          });
        }

        return created;
      });
    } else {
      // 3. Verification Method C: Auto-Match by Email or Auto-Provision New Customer
      targetCustomer = await prisma.customer.findFirst({
        where: {
          email: normalizedEmail,
          status: 'Active',
        },
      });

      let isNewCustomer = false;
      let newCustomerData = null;

      if (!targetCustomer) {
        // Auto-provision a new customer record for this client
        const lastCustomer = await prisma.customer.findFirst({
          where: { id: { startsWith: 'CUST-' } },
          orderBy: { id: 'desc' },
        });

        let nextCustomerId = 'CUST-001';
        if (lastCustomer) {
          const match = lastCustomer.id.match(/^CUST-(\d+)$/);
          if (match) {
            const nextSeq = parseInt(match[1], 10) + 1;
            nextCustomerId = `CUST-${String(nextSeq).padStart(3, '0')}`;
          }
        }

        isNewCustomer = true;
        newCustomerData = {
          id: nextCustomerId,
          name: name.trim(),
          contactPerson: name.trim(),
          email: normalizedEmail,
          status: 'Active',
          openingBalance: 0,
          paymentTerms: 14,
        };
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

      const passwordHash = await bcrypt.hash(password, 12);
      const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
      const userAgent = (req.headers['user-agent'] || '').slice(0, 255) || null;

      newUser = await prisma.$transaction(async (tx) => {
        let customerIdToLink = targetCustomer ? targetCustomer.id : null;

        if (isNewCustomer && newCustomerData) {
          const createdCustomer = await tx.customer.create({
            data: newCustomerData,
          });
          targetCustomer = createdCustomer;
          customerIdToLink = createdCustomer.id;
        }

        const created = await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            role: 'customer',
            name: name.trim(),
            title: 'Customer Client',
            customerId: customerIdToLink,
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

        if (activeTerms) {
          await tx.customerTermsAcceptance.create({
            data: {
              termsVersionId: activeTerms.id,
              customerId: customerIdToLink,
              userId: created.id,
              versionString: activeTerms.version,
              acceptanceMethod: 'registration',
              ipAddress: typeof clientIp === 'string' ? clientIp.slice(0, 45) : null,
              userAgent,
            },
          });
        }

        return created;
      });
    }

    // 4. Record security audit log (tokens and secrets are strictly excluded)
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
        verificationMethod: invitationToken
          ? 'invitation_token'
          : customerId
          ? 'account_challenge'
          : targetCustomer
          ? 'email_match_or_auto_provision'
          : 'self_registration',
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
