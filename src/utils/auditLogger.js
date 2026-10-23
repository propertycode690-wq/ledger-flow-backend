import prisma from '../config/db.js';

/**
 * Universal helper to record enterprise audit logs into MySQL database.
 */
export async function logAuditEvent({
  userId,
  userEmail,
  userRole,
  action,
  entityType,
  entityId,
  details,
  req,
}) {
  try {
    const actorId = userId || req?.user?.id || null;
    const actorEmail = userEmail || req?.user?.email || 'system';
    const actorRole = userRole || req?.user?.role || 'system';
    const ipAddress = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || null;

    return await prisma.auditLog.create({
      data: {
        userId: actorId,
        userEmail: actorEmail,
        userRole: actorRole,
        action,
        entityType,
        entityId: entityId ? String(entityId) : null,
        details: typeof details === 'object' ? JSON.stringify(details) : details,
        ipAddress: ipAddress ? String(ipAddress).slice(0, 45) : null,
      },
    });
  } catch (error) {
    console.error('Audit log write error:', error.message);
    return null;
  }
}
