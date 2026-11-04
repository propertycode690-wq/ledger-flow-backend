import { z } from 'zod';
import prisma from '../config/db.js';
import { logAuditEvent } from '../utils/auditLogger.js';

export const createTermsDraftSchema = z.object({
  version: z.string().trim().min(1, 'Version code is required.').max(50),
  title: z.string().trim().min(1, 'Title is required.').max(255),
  content: z.string().min(1, 'Content is required.'),
  requiresReacceptance: z.boolean().optional().default(true),
});

export const updateTermsDraftSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(255).optional(),
  content: z.string().min(1, 'Content is required.').optional(),
  requiresReacceptance: z.boolean().optional(),
});

export const acceptTermsSchema = z.object({
  termsVersionId: z.string().uuid().optional().nullable(),
  acceptanceMethod: z.enum(['registration', 'portal_prompt', 'admin_recorded']).optional().default('portal_prompt'),
});

/**
 * @route   GET /api/v1/terms/current
 * @desc    Get active published Terms & Conditions and current user's acceptance status
 * @access  Public / Optional Auth
 */
export async function getCurrentTerms(req, res) {
  try {
    const activeTerms = await prisma.termsVersion.findFirst({
      where: { status: 'published' },
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        version: true,
        title: true,
        content: true,
        status: true,
        requiresReacceptance: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!activeTerms) {
      return res.status(200).json({
        status: 'ok',
        data: {
          terms: null,
          hasAccepted: true, // If no terms configured, don't block
          acceptance: null,
        },
      });
    }

    // Check acceptance if user is logged in
    let hasAccepted = false;
    let acceptanceRecord = null;

    if (req.user) {
      // Non-customer roles (admin, accountant) are never blocked by customer terms
      if (req.user.role !== 'customer') {
        hasAccepted = true;
      } else {
        acceptanceRecord = await prisma.customerTermsAcceptance.findUnique({
          where: {
            userId_termsVersionId: {
              userId: req.user.id,
              termsVersionId: activeTerms.id,
            },
          },
          select: {
            id: true,
            termsVersionId: true,
            versionString: true,
            acceptedAt: true,
            acceptanceMethod: true,
          },
        });

        hasAccepted = !!acceptanceRecord;
      }
    }

    return res.status(200).json({
      status: 'ok',
      data: {
        terms: activeTerms,
        hasAccepted,
        acceptance: acceptanceRecord,
      },
    });
  } catch (error) {
    console.error('getCurrentTerms error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve active Terms & Conditions.',
    });
  }
}

/**
 * @route   POST /api/v1/terms/accept
 * @desc    Explicitly record acceptance of Terms & Conditions for an authenticated customer
 * @access  Protected (Customer role only)
 */
export async function acceptTerms(req, res) {
  try {
    if (!req.user || req.user.role !== 'customer') {
      return res.status(403).json({
        status: 'error',
        code: 'FORBIDDEN',
        message: 'Terms & Conditions acceptance is applicable only to customer portal accounts.',
      });
    }

    if (!req.user.customerId) {
      return res.status(400).json({
        status: 'error',
        code: 'NO_CUSTOMER_LINK',
        message: 'Your user profile is not linked to an active customer record.',
      });
    }

    const { termsVersionId, acceptanceMethod } = req.validatedBody || {};

    // Find target version or default to active published version
    let targetVersion = null;
    if (termsVersionId) {
      targetVersion = await prisma.termsVersion.findUnique({
        where: { id: termsVersionId },
      });
    } else {
      targetVersion = await prisma.termsVersion.findFirst({
        where: { status: 'published' },
        orderBy: { publishedAt: 'desc' },
      });
    }

    if (!targetVersion) {
      return res.status(404).json({
        status: 'error',
        code: 'TERMS_NOT_FOUND',
        message: 'The requested Terms & Conditions version was not found.',
      });
    }

    if (targetVersion.status !== 'published') {
      return res.status(400).json({
        status: 'error',
        code: 'TERMS_NOT_PUBLISHED',
        message: 'Only published Terms & Conditions versions can be accepted.',
      });
    }

    // Idempotent check: if already accepted, return existing record
    const existing = await prisma.customerTermsAcceptance.findUnique({
      where: {
        userId_termsVersionId: {
          userId: req.user.id,
          termsVersionId: targetVersion.id,
        },
      },
    });

    if (existing) {
      return res.status(200).json({
        status: 'ok',
        message: 'Terms & Conditions were already accepted.',
        data: existing,
      });
    }

    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    const userAgent = (req.headers['user-agent'] || '').slice(0, 255) || null;

    const createdAcceptance = await prisma.customerTermsAcceptance.create({
      data: {
        termsVersionId: targetVersion.id,
        customerId: req.user.customerId,
        userId: req.user.id,
        versionString: targetVersion.version,
        acceptanceMethod: acceptanceMethod || 'portal_prompt',
        ipAddress: typeof clientIp === 'string' ? clientIp.slice(0, 45) : null,
        userAgent,
      },
    });

    await logAuditEvent({
      action: 'CUSTOMER_TERMS_ACCEPTED',
      entityType: 'CustomerTermsAcceptance',
      entityId: createdAcceptance.id,
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      details: {
        termsVersionId: targetVersion.id,
        versionString: targetVersion.version,
        customerId: req.user.customerId,
        acceptanceMethod: createdAcceptance.acceptanceMethod,
      },
      req,
    });

    return res.status(201).json({
      status: 'ok',
      message: 'Terms & Conditions accepted successfully.',
      data: createdAcceptance,
    });
  } catch (error) {
    if (error.code === 'P2002') {
      // Handled duplicate key race condition
      const record = await prisma.customerTermsAcceptance.findFirst({
        where: {
          userId: req.user.id,
          termsVersionId: req.validatedBody?.termsVersionId,
        },
      });
      return res.status(200).json({
        status: 'ok',
        message: 'Terms & Conditions were already accepted.',
        data: record,
      });
    }

    console.error('acceptTerms error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to record Terms & Conditions acceptance.',
    });
  }
}

/**
 * @route   GET /api/v1/terms/versions
 * @desc    List all Terms & Conditions versions with acceptance counts
 * @access  Protected (Admin only)
 */
export async function listTermsVersions(req, res) {
  try {
    const versions = await prisma.termsVersion.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { acceptances: true },
        },
      },
    });

    return res.status(200).json({
      status: 'ok',
      data: versions,
    });
  } catch (error) {
    console.error('listTermsVersions error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to list Terms & Conditions versions.',
    });
  }
}

/**
 * @route   GET /api/v1/terms/versions/:id
 * @desc    Get detailed Terms & Conditions version by ID
 * @access  Protected (Admin only)
 */
export async function getTermsVersionById(req, res) {
  try {
    const version = await prisma.termsVersion.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: { acceptances: true },
        },
      },
    });

    if (!version) {
      return res.status(404).json({
        status: 'error',
        code: 'TERMS_NOT_FOUND',
        message: 'Terms & Conditions version not found.',
      });
    }

    return res.status(200).json({
      status: 'ok',
      data: version,
    });
  } catch (error) {
    console.error('getTermsVersionById error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch Terms & Conditions version.',
    });
  }
}

/**
 * @route   POST /api/v1/terms/versions
 * @desc    Create a new draft Terms & Conditions version
 * @access  Protected (Admin only)
 */
export async function createTermsDraft(req, res) {
  const { version, title, content, requiresReacceptance } = req.validatedBody;

  try {
    const existing = await prisma.termsVersion.findUnique({
      where: { version },
    });

    if (existing) {
      return res.status(409).json({
        status: 'error',
        code: 'VERSION_EXISTS',
        message: `A Terms & Conditions version with code "${version}" already exists.`,
      });
    }

    const created = await prisma.termsVersion.create({
      data: {
        version,
        title,
        content,
        status: 'draft',
        requiresReacceptance: requiresReacceptance ?? true,
      },
    });

    await logAuditEvent({
      action: 'TERMS_DRAFT_CREATED',
      entityType: 'TermsVersion',
      entityId: created.id,
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      details: { version: created.version, title: created.title },
      req,
    });

    return res.status(201).json({
      status: 'ok',
      message: 'Terms & Conditions draft created successfully.',
      data: created,
    });
  } catch (error) {
    console.error('createTermsDraft error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to create Terms & Conditions draft.',
    });
  }
}

/**
 * @route   PUT /api/v1/terms/versions/:id
 * @desc    Update an existing Terms & Conditions draft
 * @access  Protected (Admin only)
 */
export async function updateTermsDraft(req, res) {
  const { id } = req.params;
  const { title, content, requiresReacceptance } = req.validatedBody;

  try {
    const existing = await prisma.termsVersion.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        status: 'error',
        code: 'TERMS_NOT_FOUND',
        message: 'Terms & Conditions version not found.',
      });
    }

    if (existing.status === 'archived') {
      return res.status(400).json({
        status: 'error',
        code: 'VERSION_ARCHIVED',
        message: 'Archived Terms & Conditions versions cannot be modified.',
      });
    }

    const updated = await prisma.termsVersion.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
        ...(requiresReacceptance !== undefined && { requiresReacceptance }),
      },
    });

    await logAuditEvent({
      action: 'TERMS_DRAFT_UPDATED',
      entityType: 'TermsVersion',
      entityId: updated.id,
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      details: { version: updated.version, status: updated.status },
      req,
    });

    return res.status(200).json({
      status: 'ok',
      message: 'Terms & Conditions draft updated successfully.',
      data: updated,
    });
  } catch (error) {
    console.error('updateTermsDraft error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to update Terms & Conditions draft.',
    });
  }
}

/**
 * @route   POST /api/v1/terms/versions/:id/publish
 * @desc    Publish a Terms & Conditions version (archives prior active version)
 * @access  Protected (Admin only)
 */
export async function publishTermsVersion(req, res) {
  const { id } = req.params;

  try {
    const target = await prisma.termsVersion.findUnique({
      where: { id },
    });

    if (!target) {
      return res.status(404).json({
        status: 'error',
        code: 'TERMS_NOT_FOUND',
        message: 'Terms & Conditions version not found.',
      });
    }

    if (target.status === 'published') {
      return res.status(400).json({
        status: 'error',
        code: 'ALREADY_PUBLISHED',
        message: 'This version is already the active published version.',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Archive current published versions
      await tx.termsVersion.updateMany({
        where: { status: 'published' },
        data: { status: 'archived' },
      });

      // Publish target version
      const published = await tx.termsVersion.update({
        where: { id },
        data: {
          status: 'published',
          publishedAt: new Date(),
          publishedByUserId: req.user.id,
        },
      });

      return published;
    });

    await logAuditEvent({
      action: 'TERMS_VERSION_PUBLISHED',
      entityType: 'TermsVersion',
      entityId: result.id,
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      details: {
        version: result.version,
        title: result.title,
        requiresReacceptance: result.requiresReacceptance,
      },
      req,
    });

    return res.status(200).json({
      status: 'ok',
      message: `Terms & Conditions version ${result.version} has been published successfully.`,
      data: result,
    });
  } catch (error) {
    console.error('publishTermsVersion error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to publish Terms & Conditions version.',
    });
  }
}

/**
 * @route   GET /api/v1/terms/acceptances
 * @desc    List customer Terms & Conditions acceptance audit records
 * @access  Protected (Admin only)
 */
export async function listTermsAcceptances(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const { version, customerId, search } = req.query;

    const where = {};

    if (version) {
      where.versionString = version;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    if (search && search.trim() !== '') {
      const q = search.trim();
      where.OR = [
        { customer: { name: { contains: q } } },
        { user: { email: { contains: q } } },
        { user: { name: { contains: q } } },
      ];
    }

    const [total, acceptances] = await Promise.all([
      prisma.customerTermsAcceptance.count({ where }),
      prisma.customerTermsAcceptance.findMany({
        where,
        skip,
        take: limit,
        orderBy: { acceptedAt: 'desc' },
        include: {
          customer: {
            select: { id: true, name: true, contactPerson: true, email: true },
          },
          user: {
            select: { id: true, name: true, email: true, role: true },
          },
          termsVersion: {
            select: { id: true, version: true, title: true, status: true },
          },
        },
      }),
    ]);

    return res.status(200).json({
      status: 'ok',
      data: acceptances,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('listTermsAcceptances error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to list Terms & Conditions acceptance audit records.',
    });
  }
}

