import prisma from '../config/db.js';

/**
 * Concurrency-safe atomic sequential identifier generator for invoices and payments.
 * Uses atomic row increments on invoice_sequences inside database transactions.
 */

/**
 * Generates the next sequential invoice number within an interactive transaction.
 * @param {import('@prisma/client').PrismaClient} tx Prisma transaction client
 * @param {number} [year] Target calendar year (defaults to current year)
 * @returns {Promise<string>} e.g. "INV-2026-090"
 */
export async function getNextInvoiceNumber(tx, year = new Date().getFullYear()) {
  const prefix = `INV-${year}-`;

  // Check if a sequence record already exists
  const existing = await tx.invoiceSequence.findUnique({
    where: { prefix },
  });

  let assignedNumber = 1;

  if (!existing) {
    // If not existing, check business_settings for baseline configured starting number
    const settings = await tx.businessSettings.findFirst({
      where: { id: 1 },
      select: { nextInvoiceNumber: true },
    });
    const baseline = settings?.nextInvoiceNumber || 1;
    assignedNumber = baseline;

    await tx.invoiceSequence.create({
      data: {
        prefix,
        nextNumber: baseline + 1,
      },
    });
  } else {
    // Atomic increment
    const updated = await tx.invoiceSequence.update({
      where: { prefix },
      data: {
        nextNumber: { increment: 1 },
      },
    });
    assignedNumber = updated.nextNumber - 1;
  }

  return `${prefix}${String(assignedNumber).padStart(3, '0')}`;
}

/**
 * Generates the next sequential payment number within an interactive transaction.
 * @param {import('@prisma/client').PrismaClient} tx Prisma transaction client
 * @param {number} [year] Target calendar year (defaults to current year)
 * @returns {Promise<string>} e.g. "PAY-2026-001"
 */
export async function getNextPaymentNumber(tx, year = new Date().getFullYear()) {
  const prefix = `PAY-${year}-`;

  const existing = await tx.invoiceSequence.findUnique({
    where: { prefix },
  });

  let assignedNumber = 1;

  if (!existing) {
    assignedNumber = 1;
    await tx.invoiceSequence.create({
      data: {
        prefix,
        nextNumber: 2,
      },
    });
  } else {
    const updated = await tx.invoiceSequence.update({
      where: { prefix },
      data: {
        nextNumber: { increment: 1 },
      },
    });
    assignedNumber = updated.nextNumber - 1;
  }

  return `${prefix}${String(assignedNumber).padStart(3, '0')}`;
}

/**
 * Generates the next sequential daily order number within an interactive transaction.
 * @param {import('@prisma/client').PrismaClient} tx Prisma transaction client
 * @param {string} [dateStr] Order date string in YYYY-MM-DD format
 * @returns {Promise<string>} e.g. "ORD-2026-10-05-01"
 */
export async function getNextOrderNumber(tx, dateStr = new Date().toISOString().split('T')[0]) {
  const prefix = `ORD-${dateStr}-`;

  const existing = await tx.invoiceSequence.findUnique({
    where: { prefix },
  });

  let assignedNumber = 1;

  if (!existing) {
    assignedNumber = 1;
    await tx.invoiceSequence.create({
      data: {
        prefix,
        nextNumber: 2,
      },
    });
  } else {
    const updated = await tx.invoiceSequence.update({
      where: { prefix },
      data: {
        nextNumber: { increment: 1 },
      },
    });
    assignedNumber = updated.nextNumber - 1;
  }

  return `${prefix}${String(assignedNumber).padStart(2, '0')}`;
}

/**
 * Generates the next sequential mileage record number within an interactive transaction.
 * @param {import('@prisma/client').PrismaClient} tx Prisma transaction client
 * @param {number} [year] Target calendar year
 * @returns {Promise<string>} e.g. "MIL-2026-001"
 */
export async function getNextMileageNumber(tx, year = new Date().getFullYear()) {
  const prefix = `MIL-${year}-`;

  const existing = await tx.invoiceSequence.findUnique({
    where: { prefix },
  });

  let assignedNumber = 1;

  if (!existing) {
    assignedNumber = 1;
    await tx.invoiceSequence.create({
      data: {
        prefix,
        nextNumber: 2,
      },
    });
  } else {
    const updated = await tx.invoiceSequence.update({
      where: { prefix },
      data: {
        nextNumber: { increment: 1 },
      },
    });
    assignedNumber = updated.nextNumber - 1;
  }

  return `${prefix}${String(assignedNumber).padStart(3, '0')}`;
}

/**
 * Generates the next sequential vehicle expense record number within an interactive transaction.
 * @param {import('@prisma/client').PrismaClient} tx Prisma transaction client
 * @param {number} [year] Target calendar year
 * @returns {Promise<string>} e.g. "EXP-2026-001"
 */
export async function getNextExpenseNumber(tx, year = new Date().getFullYear()) {
  const prefix = `EXP-${year}-`;

  const existing = await tx.invoiceSequence.findUnique({
    where: { prefix },
  });

  let assignedNumber = 1;

  if (!existing) {
    assignedNumber = 1;
    await tx.invoiceSequence.create({
      data: {
        prefix,
        nextNumber: 2,
      },
    });
  } else {
    const updated = await tx.invoiceSequence.update({
      where: { prefix },
      data: {
        nextNumber: { increment: 1 },
      },
    });
    assignedNumber = updated.nextNumber - 1;
  }

  return `${prefix}${String(assignedNumber).padStart(3, '0')}`;
}

/**
 * Generates the next sequential purchase bill number within an interactive transaction.
 * @param {import('@prisma/client').PrismaClient} tx Prisma transaction client
 * @param {number} [year] Target calendar year
 * @returns {Promise<string>} e.g. "PUR-2026-035"
 */
export async function getNextPurchaseNumber(tx, year = new Date().getFullYear()) {
  const prefix = `PUR-${year}-`;

  const existing = await tx.invoiceSequence.findUnique({
    where: { prefix },
  });

  let assignedNumber = 35; // Baseline: preserves mock range 001-034

  if (!existing) {
    await tx.invoiceSequence.create({
      data: {
        prefix,
        nextNumber: assignedNumber + 1,
      },
    });
  } else {
    const updated = await tx.invoiceSequence.update({
      where: { prefix },
      data: {
        nextNumber: { increment: 1 },
      },
    });
    assignedNumber = updated.nextNumber - 1;
  }

  return `${prefix}${String(assignedNumber).padStart(3, '0')}`;
}

/**
 * Generates the next sequential supplier ID within an interactive transaction.
 * @param {import('@prisma/client').PrismaClient} tx Prisma transaction client
 * @returns {Promise<string>} e.g. "SUP-001"
 */
export async function getNextSupplierId(tx) {
  const prefix = 'SUP-';

  const existing = await tx.invoiceSequence.findUnique({
    where: { prefix },
  });

  let assignedNumber = 1;

  if (!existing) {
    await tx.invoiceSequence.create({
      data: {
        prefix,
        nextNumber: 2,
      },
    });
  } else {
    const updated = await tx.invoiceSequence.update({
      where: { prefix },
      data: {
        nextNumber: { increment: 1 },
      },
    });
    assignedNumber = updated.nextNumber - 1;
  }

  return `${prefix}${String(assignedNumber).padStart(3, '0')}`;
}

/**
 * Concurrency-safe atomic sequential identifier generator for general ledger transactions.
 * Uses atomic row increments on invoice_sequences inside database transactions.
 * Safely handles first-time yearly initialization under concurrent requests without race conditions.
 * @param {import('@prisma/client').PrismaClient} tx Prisma transaction client
 * @param {number} [year] Target calendar year (defaults to current year)
 * @returns {Promise<string>} e.g. "TXN-2026-101"
 */
export async function getNextTransactionNumber(tx, year = new Date().getFullYear()) {
  const validYear = typeof year === 'number' && !isNaN(year) ? Math.floor(year) : new Date().getFullYear();
  const prefix = `TXN-${validYear}-`;

  const existing = await tx.invoiceSequence.findUnique({
    where: { prefix },
  });

  let startingNumber = 101; // Baseline: preserves mock/sample range 001-100

  if (!existing) {
    // If no counter row exists yet, check highest existing transaction for this prefix numerically
    try {
      const rows = await tx.$queryRaw`
        SELECT transaction_number AS txnNum
        FROM transactions
        WHERE transaction_number LIKE ${prefix + '%'}
        ORDER BY CHAR_LENGTH(transaction_number) DESC, transaction_number DESC
        LIMIT 1
      `;
      if (Array.isArray(rows) && rows.length > 0 && rows[0]?.txnNum) {
        const parts = rows[0].txnNum.split('-');
        const num = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(num)) startingNumber = Math.max(startingNumber, num + 1);
      }
    } catch {
      // Safe fallback if raw query is not supported
      const txns = await tx.transaction.findMany({
        where: { transactionNumber: { startsWith: prefix } },
        select: { transactionNumber: true },
        take: 500,
      });
      for (const t of txns) {
        const parts = t.transactionNumber.split('-');
        const num = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(num) && num >= startingNumber) {
          startingNumber = num + 1;
        }
      }
    }
  }

  // Atomic upsert: In MySQL, this translates to: INSERT ... ON DUPLICATE KEY UPDATE next_number = next_number + 1.
  // This eliminates reliance on catching P2002 errors, preventing transaction poisoning, and serializes safely.
  const seq = await tx.invoiceSequence.upsert({
    where: { prefix },
    create: {
      prefix,
      nextNumber: startingNumber + 1,
    },
    update: {
      nextNumber: { increment: 1 },
    },
  });

  const assignedNumber = seq.nextNumber - 1;
  return `${prefix}${String(assignedNumber).padStart(3, '0')}`;
}
