import prisma from '../config/db.js';
import { z } from 'zod';
import { roundMoney } from '../utils/money.js';

export const saveVatReturnSchema = z.object({
  periodKey: z.string().trim().min(2).max(50),
  periodLabel: z.string().trim().min(2).max(100),
  startDate: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid startDate.'),
  endDate: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid endDate.'),
  collectedVat: z.number().nonnegative(),
  paidVat: z.number().nonnegative(),
  netVatDue: z.number(),
  totalSales: z.number().nonnegative(),
  totalPurchases: z.number().nonnegative(),
  status: z.enum(['Draft', 'Submitted']).default('Submitted'),
  notes: z.string().optional().nullable(),
});

/**
 * Standard UK quarterly date ranges helper
 */
const PERIOD_PRESETS = {
  'Q3 2026': { start: '2026-07-01', end: '2026-09-30', label: 'Q3 2026 (1 Jul - 30 Sep 2026)' },
  'Q2 2026': { start: '2026-04-01', end: '2026-06-30', label: 'Q2 2026 (1 Apr - 30 Jun 2026)' },
  'Q1 2026': { start: '2026-01-01', end: '2026-03-31', label: 'Q1 2026 (1 Jan - 31 Mar 2026)' },
  'Q4 2025': { start: '2025-10-01', end: '2025-12-31', label: 'Q4 2025 (1 Oct - 31 Dec 2025)' },
};

/**
 * @route   GET /api/v1/reports/vat-return
 * @desc    Compute official UK HMRC MTD VAT Return from active Invoices & Purchases
 * @access  Admin, Accountant
 */
export async function getVatReturn(req, res) {
  try {
    let { startDate, endDate, period } = req.query;

    if (period && PERIOD_PRESETS[period]) {
      startDate = PERIOD_PRESETS[period].start;
      endDate = PERIOD_PRESETS[period].end;
    }

    const start = startDate ? new Date(startDate) : new Date('2020-01-01');
    const end = endDate ? new Date(endDate) : new Date('2099-12-31');
    end.setHours(23, 59, 59, 999);

    // 1. Output VAT (Sales Invoices excluding Draft & Void)
    const invoices = await prisma.invoice.findMany({
      where: {
        issueDate: { gte: start, lte: end },
        status: { notIn: ['Draft', 'Void'] },
      },
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        subtotal: true,
        vatAmount: true,
        total: true,
        customer: { select: { name: true } },
      },
    });

    const invoiceVat = invoices.reduce((sum, inv) => sum + Number(inv.vatAmount || 0), 0);
    const invoiceSales = invoices.reduce((sum, inv) => sum + Number(inv.subtotal || 0), 0);

    // 2. Output VAT from general income transactions
    const incomeTransactions = await prisma.transaction.findMany({
      where: {
        date: { gte: start, lte: end },
        type: 'Income',
        status: { not: 'Cancelled' },
      },
      select: {
        id: true,
        transactionNumber: true,
        date: true,
        netAmount: true,
        vatAmount: true,
        grossAmount: true,
        category: true,
      },
    });

    const txnIncomeVat = incomeTransactions.reduce((sum, t) => sum + Number(t.vatAmount || 0), 0);
    const txnIncomeSales = incomeTransactions.reduce((sum, t) => sum + Number(t.netAmount || 0), 0);

    // Box 1: Total Output VAT collected
    const collectedVat = roundMoney(invoiceVat > 0 ? invoiceVat : txnIncomeVat);
    const totalSales = roundMoney(invoiceSales > 0 ? invoiceSales : txnIncomeSales);

    // 3. Input VAT from wholesale produce purchases
    const purchases = await prisma.purchase.findMany({
      where: {
        date: { gte: start, lte: end },
        status: { not: 'Cancelled' },
      },
      select: {
        id: true,
        purchaseNumber: true,
        date: true,
        subtotal: true,
        vatAmount: true,
        total: true,
        supplierName: true,
      },
    });

    const purchaseVat = purchases.reduce((sum, p) => sum + Number(p.vatAmount || 0), 0);
    const purchaseCost = purchases.reduce((sum, p) => sum + Number(p.subtotal || 0), 0);

    // 4. Input VAT from operational expense transactions (excluding duplicate purchase records)
    const expenseTransactions = await prisma.transaction.findMany({
      where: {
        date: { gte: start, lte: end },
        type: { notIn: ['Income', 'Purchase'] },
        status: { not: 'Cancelled' },
      },
      select: {
        id: true,
        transactionNumber: true,
        date: true,
        netAmount: true,
        vatAmount: true,
        grossAmount: true,
        category: true,
      },
    });

    const expenseVat = expenseTransactions.reduce((sum, t) => sum + Number(t.vatAmount || 0), 0);
    const expenseCost = expenseTransactions.reduce((sum, t) => sum + Number(t.netAmount || 0), 0);

    // Box 4: Total Input VAT paid
    const paidVat = roundMoney(purchaseVat + expenseVat);
    const totalPurchases = roundMoney(purchaseCost + expenseCost);

    // Box 5: Net VAT due
    const netVatDue = roundMoney(collectedVat - paidVat);

    return res.status(200).json({
      status: 'ok',
      data: {
        period: period || 'Custom Range',
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
        hmrcBoxes: {
          box1_vatDueSales: collectedVat,
          box2_vatDueAcquisitions: 0.00,
          box3_totalVatDue: collectedVat,
          box4_vatReclaimedPurchases: paidVat,
          box5_netVatPayable: Math.max(0, netVatDue),
          box5_netVatReclaimable: netVatDue < 0 ? Math.abs(netVatDue) : 0.00,
          box6_totalSalesExVat: totalSales,
          box7_totalPurchasesExVat: totalPurchases,
        },
        summary: {
          collectedVat,
          paidVat,
          netVatDue,
          totalSales,
          totalPurchases,
        },
        counts: {
          invoicesCount: invoices.length,
          purchasesCount: purchases.length,
          expensesCount: expenseTransactions.length,
        },
      },
    });
  } catch (error) {
    console.error('getVatReturn error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to compute VAT return.',
    });
  }
}

/**
 * @route   GET /api/v1/reports/vat-returns
 * @desc    List submitted / saved quarterly VAT return history
 * @access  Admin, Accountant
 */
export async function listVatReturns(req, res) {
  try {
    const records = await prisma.vatReturn.findMany({
      orderBy: { startDate: 'desc' },
    });

    return res.status(200).json({
      status: 'ok',
      data: records,
    });
  } catch (error) {
    console.error('listVatReturns error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve saved VAT returns.',
    });
  }
}

/**
 * @route   POST /api/v1/reports/vat-returns
 * @desc    Save/Submit quarterly VAT return record
 * @access  Admin, Accountant
 */
export async function saveVatReturn(req, res) {
  try {
    const data = req.validatedBody;

    const record = await prisma.vatReturn.upsert({
      where: { periodKey: data.periodKey },
      update: {
        periodLabel: data.periodLabel,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        collectedVat: data.collectedVat,
        paidVat: data.paidVat,
        netVatDue: data.netVatDue,
        totalSales: data.totalSales,
        totalPurchases: data.totalPurchases,
        status: data.status,
        submittedAt: data.status === 'Submitted' ? new Date() : null,
        submittedBy: req.user?.email || 'Admin',
        notes: data.notes || null,
      },
      create: {
        periodKey: data.periodKey,
        periodLabel: data.periodLabel,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        collectedVat: data.collectedVat,
        paidVat: data.paidVat,
        netVatDue: data.netVatDue,
        totalSales: data.totalSales,
        totalPurchases: data.totalPurchases,
        status: data.status,
        submittedAt: data.status === 'Submitted' ? new Date() : null,
        submittedBy: req.user?.email || 'Admin',
        notes: data.notes || null,
      },
    });

    return res.status(200).json({
      status: 'ok',
      message: `VAT return for ${data.periodKey} successfully recorded.`,
      data: record,
    });
  } catch (error) {
    console.error('saveVatReturn error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to record VAT return.',
    });
  }
}

/**
 * @route   GET /api/v1/reports/pnl
 * @desc    Compute comprehensive Profit & Loss (P&L) Statement
 * @access  Admin, Accountant
 */
export async function getProfitAndLoss(req, res) {
  try {
    let { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date('2020-01-01');
    const end = endDate ? new Date(endDate) : new Date('2099-12-31');
    end.setHours(23, 59, 59, 999);

    // 1. Revenue
    const invoices = await prisma.invoice.findMany({
      where: {
        issueDate: { gte: start, lte: end },
        status: { notIn: ['Draft', 'Void'] },
      },
      select: { subtotal: true, total: true },
    });
    const invoiceRevenue = invoices.reduce((sum, i) => sum + Number(i.subtotal || 0), 0);

    const incomeTxns = await prisma.transaction.findMany({
      where: {
        date: { gte: start, lte: end },
        type: 'Income',
        status: { not: 'Cancelled' },
      },
      select: { netAmount: true },
    });
    const txnRevenue = incomeTxns.reduce((sum, t) => sum + Number(t.netAmount || 0), 0);

    const totalRevenue = roundMoney(invoiceRevenue > 0 ? invoiceRevenue : txnRevenue);

    // 2. Cost of Goods Sold (COGS)
    const purchases = await prisma.purchase.findMany({
      where: {
        date: { gte: start, lte: end },
        status: { not: 'Cancelled' },
      },
      select: { subtotal: true },
    });
    const cogs = roundMoney(purchases.reduce((sum, p) => sum + Number(p.subtotal || 0), 0));

    // 3. Gross Profit
    const grossProfit = roundMoney(totalRevenue - cogs);
    const grossMarginPercent = totalRevenue > 0 ? roundMoney((grossProfit / totalRevenue) * 100) : 0;

    // 4. Operating Expenses
    const expenses = await prisma.transaction.findMany({
      where: {
        date: { gte: start, lte: end },
        type: { notIn: ['Income', 'Purchase'] },
        status: { not: 'Cancelled' },
      },
      select: { netAmount: true, category: true },
    });

    const expensesByCategory = {};
    let totalOperatingExpenses = 0;

    for (const exp of expenses) {
      const cat = exp.category || 'General';
      const amt = Number(exp.netAmount || 0);
      expensesByCategory[cat] = roundMoney((expensesByCategory[cat] || 0) + amt);
      totalOperatingExpenses += amt;
    }
    totalOperatingExpenses = roundMoney(totalOperatingExpenses);

    // 5. Net Profit
    const netProfit = roundMoney(grossProfit - totalOperatingExpenses);
    const netMarginPercent = totalRevenue > 0 ? roundMoney((netProfit / totalRevenue) * 100) : 0;

    return res.status(200).json({
      status: 'ok',
      data: {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
        revenue: {
          totalRevenue,
          invoicesCount: invoices.length,
        },
        costOfGoodsSold: {
          cogs,
          purchasesCount: purchases.length,
        },
        grossProfit,
        grossMarginPercent,
        operatingExpenses: {
          totalOperatingExpenses,
          breakdown: expensesByCategory,
        },
        netProfit,
        netMarginPercent,
      },
    });
  } catch (error) {
    console.error('getProfitAndLoss error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to compute Profit & Loss statement.',
    });
  }
}

/**
 * @route   GET /api/v1/reports/aged-debtors
 * @desc    Compute aged debtors receivables (0-30, 31-60, 61-90, 90+ days)
 * @access  Admin, Accountant
 */
export async function getAgedDebtors(req, res) {
  try {
    const today = new Date();

    const customers = await prisma.customer.findMany({
      where: { status: 'Active' },
      include: {
        invoices: {
          where: {
            status: { notIn: ['Paid', 'Void', 'Draft'] },
            balanceDue: { gt: 0 },
          },
          select: {
            id: true,
            invoiceNumber: true,
            issueDate: true,
            dueDate: true,
            balanceDue: true,
            total: true,
          },
        },
      },
    });

    let currentTotal = 0;   // 0 - 30 days
    let days31to60 = 0;     // 31 - 60 days
    let days61to90 = 0;     // 61 - 90 days
    let over90days = 0;     // 90+ days
    let totalOutstanding = 0;

    const debtorList = [];

    for (const cust of customers) {
      let custCurrent = 0;
      let cust31to60 = 0;
      let cust61to90 = 0;
      let custOver90 = 0;
      let custTotal = 0;

      for (const inv of cust.invoices) {
        const bal = Number(inv.balanceDue || 0);
        const ageDays = Math.max(0, Math.floor((today - new Date(inv.dueDate)) / (1000 * 60 * 60 * 24)));

        custTotal += bal;

        if (ageDays <= 30) {
          custCurrent += bal;
        } else if (ageDays <= 60) {
          cust31to60 += bal;
        } else if (ageDays <= 90) {
          cust61to90 += bal;
        } else {
          custOver90 += bal;
        }
      }

      if (custTotal > 0 || Number(cust.openingBalance) > 0) {
        currentTotal += custCurrent;
        days31to60 += cust31to60;
        days61to90 += cust61to90;
        over90days += custOver90;
        totalOutstanding += custTotal;

        debtorList.push({
          customerId: cust.id,
          customerName: cust.name,
          contactPerson: cust.contactPerson,
          phone: cust.phone,
          current: roundMoney(custCurrent),
          days31to60: roundMoney(cust31to60),
          days61to90: roundMoney(cust61to90),
          over90days: roundMoney(custOver90),
          totalBalance: roundMoney(custTotal),
          openInvoicesCount: cust.invoices.length,
        });
      }
    }

    debtorList.sort((a, b) => b.totalBalance - a.totalBalance);

    return res.status(200).json({
      status: 'ok',
      data: {
        summary: {
          current_0_30: roundMoney(currentTotal),
          days_31_60: roundMoney(days31to60),
          days_61_90: roundMoney(days61to90),
          over_90_days: roundMoney(over90days),
          totalOutstanding: roundMoney(totalOutstanding),
        },
        debtors: debtorList,
      },
    });
  } catch (error) {
    console.error('getAgedDebtors error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to compute aged debtors report.',
    });
  }
}
