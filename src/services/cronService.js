import prisma from '../config/db.js';
import { logAuditEvent } from '../utils/auditLogger.js';

/**
 * Background worker task to evaluate and transition invoices to Overdue status.
 */
export async function runOverdueInvoicesCheck() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdueCandidates = await prisma.invoice.findMany({
      where: {
        dueDate: { lt: today },
        balanceDue: { gt: 0 },
        status: { notIn: ['Paid', 'Void', 'Overdue', 'Draft'] },
      },
      include: {
        customer: { select: { id: true, name: true } },
      },
    });

    if (overdueCandidates.length === 0) {
      return { count: 0 };
    }

    let updatedCount = 0;

    for (const inv of overdueCandidates) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { status: 'Overdue' },
      });
      updatedCount++;

      // Log system audit event
      await logAuditEvent({
        action: 'INVOICE_MARKED_OVERDUE',
        entityType: 'Invoice',
        entityId: inv.id,
        details: {
          invoiceNumber: inv.invoiceNumber,
          customerName: inv.customerName,
          balanceDue: Number(inv.balanceDue),
          dueDate: inv.dueDate,
        },
      });

      // Create persistent in-app notifications
      // 1. For Business Admin & Accountant
      await prisma.notification.create({
        data: {
          role: null, // Broadcast to staff
          title: `Overdue Invoice: ${inv.invoiceNumber}`,
          description: `${inv.customerName} has an overdue balance of £${Number(inv.balanceDue).toFixed(2)}.`,
          type: 'danger',
          link: `/invoices/${inv.id}`,
        },
      }).catch(() => {});

      // 2. For Customer Client
      if (inv.customerId) {
        await prisma.notification.create({
          data: {
            role: 'customer',
            customerId: inv.customerId,
            title: `Payment Overdue: ${inv.invoiceNumber}`,
            description: `Your invoice balance of £${Number(inv.balanceDue).toFixed(2)} was due on ${inv.dueDate.toISOString().split('T')[0]}. Please settle as soon as possible.`,
            type: 'danger',
            link: '/portal?tab=invoices',
          },
        }).catch(() => {});
      }
    }

    console.log(`⏰ [Cron] Evaluated overdue invoices: ${updatedCount} marked Overdue.`);
    return { count: updatedCount };
  } catch (error) {
    console.error('❌ [Cron] Error running overdue invoices check:', error.message);
    return { count: 0, error: error.message };
  }
}

/**
 * Initialize background scheduler (runs at startup, then every 30 minutes)
 */
export function initBackgroundWorkers() {
  // Initial run after server startup
  setTimeout(() => {
    runOverdueInvoicesCheck();
  }, 3000);

  // Recurring 30-minute interval
  const interval = setInterval(() => {
    runOverdueInvoicesCheck();
  }, 30 * 60 * 1000);

  return () => clearInterval(interval);
}
