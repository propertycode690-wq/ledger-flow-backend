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


