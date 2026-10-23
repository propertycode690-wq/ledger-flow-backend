/**
 * Financial calculation and currency rounding utilities for LedgerFlow.
 * Enforces decimal-safe 2-place precision (half-up) preventing rounding drift.
 */

/**
 * Rounds a number or string to 2 decimal places using half-up arithmetic.
 * @param {number|string} value
 * @returns {number}
 */
export function round2(value) {
  if (value === null || value === undefined) return 0;
  let num;
  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'object' && typeof value.toNumber === 'function') {
    num = value.toNumber();
  } else {
    num = parseFloat(value) || 0;
  }
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates totals for a single invoice line item.
 * @param {number} quantity
 * @param {number} unitPrice
 * @param {number} vatRate Percentage (e.g. 0, 5, 20)
 * @returns {{ subtotal: number, vatAmount: number, total: number }}
 */
export function calculateLineItemTotals(quantity, unitPrice, vatRate = 0) {
  const q = round2(quantity);
  const price = round2(unitPrice);
  const vat = round2(vatRate);

  const subtotal = round2(q * price);
  const vatAmount = round2(subtotal * (vat / 100));
  const total = round2(subtotal + vatAmount);

  return { subtotal, vatAmount, total };
}

/**
 * Calculates complete totals for an invoice across all line items and discounts.
 * @param {Array<{ quantity: number, unitPrice: number, vatRate?: number }>} items
 * @param {number} discountAmount
 * @param {number} amountPaid
 * @returns {{ subtotal: number, vatAmount: number, discountAmount: number, total: number, balanceDue: number }}
 */
export function calculateInvoiceTotals(items = [], discountAmount = 0, amountPaid = 0) {
  let subtotal = 0;
  let vatAmount = 0;

  for (const item of items) {
    const line = calculateLineItemTotals(item.quantity, item.unitPrice, item.vatRate || 0);
    subtotal = round2(subtotal + line.subtotal);
    vatAmount = round2(vatAmount + line.vatAmount);
  }

  const discount = round2(discountAmount);
  const total = round2(Math.max(0, subtotal + vatAmount - discount));
  const paid = round2(amountPaid);
  const balanceDue = round2(Math.max(0, total - paid));

  return {
    subtotal,
    vatAmount,
    discountAmount: discount,
    total,
    balanceDue,
  };
}
