import { PrismaClient } from '@prisma/client';
import { getNextPurchaseNumber, getNextSupplierId } from '../utils/sequence.js';

const prisma = new PrismaClient();

async function runPurchasesVerification() {
  console.log('--- Starting Purchases Module Backend Verification ---');

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failedTests++;
    }
  }

  // Baseline check
  const initialPurchaseCount = await prisma.purchase.count();
  const initialSupplierCount = await prisma.supplier.count();
  console.log(`Initial DB State: ${initialPurchaseCount} purchases, ${initialSupplierCount} suppliers.`);

  let testPurchaseId = null;
  let testSupplierId = null;

  try {
    // 1. Sequence number generation test
    console.log('\n1. Testing Sequence Generation:');
    const seqPurchaseNum = await prisma.$transaction((tx) => getNextPurchaseNumber(tx, 2026));
    assert(seqPurchaseNum.startsWith('PUR-2026-'), `Generated purchase number format valid: ${seqPurchaseNum}`);

    const seqSupplierId = await prisma.$transaction((tx) => getNextSupplierId(tx));
    assert(seqSupplierId.startsWith('SUP-'), `Generated supplier ID format valid: ${seqSupplierId}`);

    // 2. Create Purchase test with auto-supplier creation & decimal safety
    console.log('\n2. Testing Purchase Creation & Decimal Totals:');
    const testSupplierName = 'Covent Garden Test Farm ' + Date.now();
    const testInvoiceNo = 'INV-TEST-' + Math.floor(1000 + Math.random() * 9000);

    const subtotal = 120.00;
    const vatAmount = 24.00; // 20% of 120
    const total = 144.00;

    const createdPurchase = await prisma.$transaction(async (tx) => {
      const supId = await getNextSupplierId(tx);
      const supplier = await tx.supplier.create({
        data: {
          id: supId,
          name: testSupplierName,
          contactPerson: 'John Produce',
          paymentTerms: 30,
        },
      });
      testSupplierId = supplier.id;

      const pNum = await getNextPurchaseNumber(tx, 2026);
      const purchase = await tx.purchase.create({
        data: {
          purchaseNumber: pNum,
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierInvoiceNo: testInvoiceNo,
          date: new Date('2026-10-15'),
          status: 'Paid',
          subtotal,
          vatAmount,
          total,
          items: {
            create: [
              {
                product: 'Grade A Test Apples',
                quantity: 40,
                unit: 'kg',
                unitCost: 1.50,
                vatRate: 20,
                vatAmount: 12.00,
                total: 72.00,
              },
              {
                product: 'Test Organic Pears',
                quantity: 30,
                unit: 'kg',
                unitCost: 2.00,
                vatRate: 20,
                vatAmount: 12.00,
                total: 72.00,
              },
            ],
          },
        },
        include: {
          items: true,
          supplier: true,
        },
      });
      return purchase;
    });

    testPurchaseId = createdPurchase.id;
    assert(createdPurchase.id !== undefined, 'Purchase created with valid ID');
    assert(createdPurchase.items.length === 2, 'Purchase items persisted (2 line items)');
    assert(parseFloat(createdPurchase.total.toString()) === 144.00, 'Total decimal-safe match (144.00)');
    assert(createdPurchase.supplier?.name === testSupplierName, 'Linked to created Supplier catalog');

    // 3. Duplicate Supplier Invoice detection test
    console.log('\n3. Testing Duplicate Supplier Invoice Protection:');
    const duplicateInvoiceCheck = await prisma.purchase.findFirst({
      where: {
        supplierName: testSupplierName,
        supplierInvoiceNo: testInvoiceNo,
      },
    });
    assert(duplicateInvoiceCheck !== null, 'Duplicate query successfully detected matching bill');
    assert(duplicateInvoiceCheck.id === testPurchaseId, 'Duplicate points to created purchase');

    // 4. Update purchase status test
    console.log('\n4. Testing Purchase Update:');
    const updated = await prisma.purchase.update({
      where: { id: testPurchaseId },
      data: { status: 'Pending', notes: 'Payment scheduled for month end' },
    });
    assert(updated.status === 'Pending', 'Purchase status updated to Pending');
    assert(updated.notes === 'Payment scheduled for month end', 'Notes persisted correctly');

    // 5. Soft Delete / Cancellation test
    console.log('\n5. Testing Soft Cancellation:');
    const cancelled = await prisma.purchase.update({
      where: { id: testPurchaseId },
      data: { status: 'Cancelled' },
    });
    assert(cancelled.status === 'Cancelled', 'Purchase status correctly updated to Cancelled');

    // 6. Test Import Preview Duplicate Detection logic
    console.log('\n6. Testing Migration Duplicate Safety Logic:');
    const mockBatch = [
      {
        supplierName: testSupplierName,
        supplierInvoiceNo: testInvoiceNo, // DUPLICATE
        items: [{ product: 'Test Duplicate', quantity: 10, unit: 'kg', unitCost: 1.0, vatRate: 0 }],
      },
      {
        supplierName: 'Brand New Supplier',
        supplierInvoiceNo: 'NEW-INV-999', // NEW
        items: [{ product: 'Fresh Carrots', quantity: 20, unit: 'kg', unitCost: 0.8, vatRate: 0 }],
      },
    ];

    const existingInvoices = new Set(
      (await prisma.purchase.findMany({ select: { supplierName: true, supplierInvoiceNo: true } }))
        .filter((p) => p.supplierInvoiceNo)
        .map((p) => `${p.supplierName.toLowerCase()}||${p.supplierInvoiceNo.toLowerCase()}`)
    );

    let duplicatesFound = 0;
    let newFound = 0;
    for (const b of mockBatch) {
      const isDup = existingInvoices.has(`${b.supplierName.toLowerCase()}||${b.supplierInvoiceNo.toLowerCase()}`);
      if (isDup) duplicatesFound++;
      else newFound++;
    }

    assert(duplicatesFound === 1, 'Import preview accurately identified duplicate bill');
    assert(newFound === 1, 'Import preview accurately identified 1 new bill');

  } catch (err) {
    console.error('Test execution error:', err);
    failedTests++;
  } finally {
    // Clean up test data
    console.log('\nCleaning up verification artifacts...');
    if (testPurchaseId) {
      await prisma.purchaseItem.deleteMany({ where: { purchaseId: testPurchaseId } });
      await prisma.purchase.delete({ where: { id: testPurchaseId } });
    }
    if (testSupplierId) {
      await prisma.supplier.delete({ where: { id: testSupplierId } });
    }

    const finalPurchaseCount = await prisma.purchase.count();
    const finalSupplierCount = await prisma.supplier.count();
    assert(finalPurchaseCount === initialPurchaseCount, `Purchase count cleanly restored (${finalPurchaseCount})`);
    assert(finalSupplierCount === initialSupplierCount, `Supplier count cleanly restored (${finalSupplierCount})`);

    console.log(`\n========================================`);
    console.log(`Purchases Verification Completed:`);
    console.log(`  Passed: ${passedTests}`);
    console.log(`  Failed: ${failedTests}`);
    console.log(`========================================\n`);

    await prisma.$disconnect();
    process.exit(failedTests > 0 ? 1 : 0);
  }
}

runPurchasesVerification();
