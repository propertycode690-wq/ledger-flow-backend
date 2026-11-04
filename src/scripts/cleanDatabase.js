import { PrismaClient } from '@prisma/client';
import defaultPrisma from '../config/db.js';

/**
 * LedgerFlow Safe Database Cleanup Script
 * Clears all sample and test transactional data:
 * - Invoices, invoice items, and allocations
 * - Payments and payment allocations
 * - Orders, order items, and procurement fulfillment
 * - Purchases and purchase items
 * - Mileage records and vehicle expenses
 * - General ledger transactions
 * - Audit logs and notifications
 * - VAT returns
 * 
 * Resets:
 * - Invoice sequences (starting from 1)
 * - Next invoice number in business settings (to 1)
 * - Customer opening balances (to 0.00)
 * 
 * PRESERVES (Untouched):
 * - Users & Auth accounts (Admin, Accountant, Customer)
 * - Customers Directory
 * - Products Catalog
 * - Delivery Vans
 * - Business Profile & Settings
 */
export async function cleanTransactionalData(customDbUrl) {
  const prisma = customDbUrl
    ? new PrismaClient({ datasources: { db: { url: customDbUrl } } })
    : defaultPrisma;

  console.log('====================================================');
  console.log('🧹 LedgerFlow: Cleaning all test transactional data...');
  console.log('====================================================');

  try {
    // 1. Delete dependent children line items & allocations (FK safe)
    console.log('-> Clearing payment allocations...');
    const deletedAllocations = await prisma.paymentAllocation.deleteMany({});
    
    console.log('-> Clearing invoice line items...');
    const deletedInvoiceItems = await prisma.invoiceItem.deleteMany({});
    
    console.log('-> Clearing order line items...');
    const deletedOrderItems = await prisma.orderItem.deleteMany({});
    
    console.log('-> Clearing purchase line items...');
    const deletedPurchaseItems = await prisma.purchaseItem.deleteMany({});
    
    console.log('-> Clearing vehicle expenses...');
    const deletedVehicleExpenses = await prisma.vehicleExpense.deleteMany({});

    // 2. Delete parent transactional records
    console.log('-> Clearing payments...');
    const deletedPayments = await prisma.payment.deleteMany({});
    
    console.log('-> Clearing invoices...');
    const deletedInvoices = await prisma.invoice.deleteMany({});
    
    console.log('-> Clearing orders...');
    const deletedOrders = await prisma.order.deleteMany({});
    
    console.log('-> Clearing procurement fulfillments...');
    const deletedFulfillments = await prisma.procurementFulfillment.deleteMany({});
    
    console.log('-> Clearing purchases...');
    const deletedPurchases = await prisma.purchase.deleteMany({});
    
    console.log('-> Clearing mileage records...');
    const deletedMileages = await prisma.mileage.deleteMany({});
    
    console.log('-> Clearing ledger transactions...');
    const deletedTransactions = await prisma.transaction.deleteMany({});
    
    console.log('-> Clearing VAT returns...');
    const deletedVatReturns = await prisma.vatReturn.deleteMany({});
    
    console.log('-> Clearing notifications...');
    const deletedNotifications = await prisma.notification.deleteMany({});
    
    console.log('-> Clearing audit logs...');
    const deletedAuditLogs = await prisma.auditLog.deleteMany({});

    // 3. Reset customer balances and ledger records to zero
    console.log('-> Resetting customer opening balances to 0.00...');
    await prisma.customer.updateMany({
      data: {
        openingBalance: 0.0,
      },
    });

    // 4. Reset sequence numbering so fresh records start from 1
    console.log('-> Resetting document numbering sequences to 1...');
    await prisma.invoiceSequence.deleteMany({});
    await prisma.invoiceSequence.createMany({
      data: [
        { prefix: 'INV-2026-', nextNumber: 1 },
        { prefix: 'PAY-2026-', nextNumber: 1 },
        { prefix: 'PUR-2026-', nextNumber: 1 },
        { prefix: 'EXP-2026-', nextNumber: 1 },
        { prefix: 'MIL-2026-', nextNumber: 1 },
        { prefix: 'SUP-', nextNumber: 1 },
      ],
    });

    // 5. Reset next invoice number in business settings
    console.log('-> Resetting nextInvoiceNumber in business settings to 1...');
    await prisma.businessSettings.updateMany({
      where: { id: 1 },
      data: {
        nextInvoiceNumber: 1,
      },
    });

    const result = {
      invoices: deletedInvoices.count,
      invoiceItems: deletedInvoiceItems.count,
      payments: deletedPayments.count,
      allocations: deletedAllocations.count,
      orders: deletedOrders.count,
      orderItems: deletedOrderItems.count,
      purchases: deletedPurchases.count,
      purchaseItems: deletedPurchaseItems.count,
      transactions: deletedTransactions.count,
      mileages: deletedMileages.count,
      vehicleExpenses: deletedVehicleExpenses.count,
      notifications: deletedNotifications.count,
      auditLogs: deletedAuditLogs.count,
      vatReturns: deletedVatReturns.count,
      procurementFulfillments: deletedFulfillments.count,
    };

    console.log('====================================================');
    console.log('✅ Cleanup completed successfully!');
    console.log('Deleted records count:', JSON.stringify(result, null, 2));
    console.log('✨ Database is now 100% clean and ready for fresh operational use.');
    console.log('👤 Master accounts (Users, Customers, Products, Vans) were strictly preserved.');
    console.log('====================================================');
    return result;
  } catch (error) {
    console.error('❌ Cleanup failed:', error.message || error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Auto-run if executed directly via node
if (process.argv[1] && process.argv[1].endsWith('cleanDatabase.js')) {
  const targetUrl = process.env.TARGET_DATABASE_URL || process.argv[2] || undefined;
  cleanTransactionalData(targetUrl)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

