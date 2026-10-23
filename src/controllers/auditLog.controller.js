import prisma from '../config/db.js';

/**
 * @route   GET /api/v1/audit-logs
 * @desc    List audit trail history with pagination & filters
 * @access  Admin, Accountant
 */
export async function listAuditLogs(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const { action, entityType, search, startDate, endDate } = req.query;

    const where = {};

    if (action) {
      where.action = { contains: String(action) };
    }

    if (entityType) {
      where.entityType = String(entityType);
    }

    if (search) {
      where.OR = [
        { action: { contains: String(search) } },
        { userEmail: { contains: String(search) } },
        { details: { contains: String(search) } },
        { entityId: { contains: String(search) } },
      ];
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return res.status(200).json({
      status: 'ok',
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error('listAuditLogs error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve audit logs.',
    });
  }
}
