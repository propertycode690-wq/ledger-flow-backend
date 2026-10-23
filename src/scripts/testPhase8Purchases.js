/**
 * LedgerFlow Phase 8: Purchases & Bills Full-Stack Integration Verification Suite
 * Validates complete REST API endpoints, RBAC, duplicate invoice protection,
 * decimal-safe calculations, and cleanup against real MySQL database.
 */

import http from 'http';
import app from '../app.js';
import prisma from '../config/db.js';

let server;
let baseUrl;

function logPass(msg) {
  console.log(`  \x1b[32m✅ PASS:\x1b[0m ${msg}`);
}

function logFail(msg, detail = '') {
  console.error(`  \x1b[31m❌ FAIL:\x1b[0m ${msg} ${detail ? `-> ${detail}` : ''}`);
}

async function request(method, path, { headers = {}, body, cookie } = {}) {
  const url = `${baseUrl}${path}`;
  const reqHeaders = { 'Content-Type': 'application/json', ...headers };
  if (cookie) {
    reqHeaders['Cookie'] = cookie;
  }

  const res = await fetch(url, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = res.headers.get('set-cookie');
  let data = null;
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
  }

  return {
    status: res.status,
    headers: res.headers,
    setCookie,
    data,
  };
}

async function runPurchasesSuite() {
  console.log('====================================================');
  console.log('🧪 Starting Purchases & Bills API Verification Suite');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function expect(condition, passMsg, failMsg) {
    if (condition) {
      logPass(passMsg);
      passed++;
    } else {
      logFail(failMsg || passMsg);
      failed++;
    }
  }

  // Record baseline database state
  const initialPurchaseCount = await prisma.purchase.count();
  const initialSupplierCount = await prisma.supplier.count();
  console.log(`Initial DB Baseline: ${initialPurchaseCount} purchases, ${initialSupplierCount} suppliers.\n`);

  // Start test server on random port
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      console.log(`Test server running on ${baseUrl}\n`);
      resolve();
    });
  });

  let adminCookie = '';
  let accountantCookie = '';
  let customerCookie = '';

  const createdPurchases = [];
  const createdSuppliers = [];

  try {
    // -----------------------------------------------------------------
    // 1. Authentication & Role Permissions
    // -----------------------------------------------------------------
    console.log('📋 Test Group 1: Authentication & Role Permissions');
    const adminLogin = await request('POST', '/api/v1/auth/login', {
      body: { email: 'admin@freshharvest.co.uk', password: 'Password123!' },
    });
    expect(adminLogin.status === 200, 'Admin login succeeds (200 OK)', `Status: ${adminLogin.status}`);
    adminCookie = adminLogin.setCookie;

    const accountantLogin = await request('POST', '/api/v1/auth/login', {
      body: { email: 'accounts@freshharvest.co.uk', password: 'Password123!' },
    });
    expect(accountantLogin.status === 200, 'Accountant login succeeds (200 OK)');
    accountantCookie = accountantLogin.setCookie;

    const customerLogin = await request('POST', '/api/v1/auth/login', {
      body: { email: 'accounts@greenvalley.co.uk', password: 'Password123!' },
    });
    expect(customerLogin.status === 200, 'Customer login succeeds (200 OK)');
    customerCookie = customerLogin.setCookie;

    // RBAC: Unauthenticated
    const unauthRes = await request('GET', '/api/v1/purchases');
    expect(unauthRes.status === 401, 'Unauthenticated GET /purchases rejected (401 Unauthorized)', `Status: ${unauthRes.status}`);

    // RBAC: Customer (Forbidden)
    const custRes = await request('GET', '/api/v1/purchases', { cookie: customerCookie });
    expect(custRes.status === 403, 'Customer role denied access to /purchases (403 Forbidden)', `Status: ${custRes.status}`);

    // RBAC: Accountant allowed
    const acctRes = await request('GET', '/api/v1/purchases', { cookie: accountantCookie });
    expect(acctRes.status === 200, 'Accountant role allowed access to /purchases (200 OK)');

    // -----------------------------------------------------------------
    // 2. Listing & Aggregations
    // -----------------------------------------------------------------
    console.log('\n📋 Test Group 2: Purchases Listing & Summary Metrics');
    const listRes = await request('GET', '/api/v1/purchases', { cookie: adminCookie });
    expect(listRes.status === 200, 'Admin GET /purchases returns 200 OK');
    expect(Array.isArray(listRes.data?.data), 'Response data is an array');
    expect(listRes.data?.summary?.totalPurchases !== undefined, 'Response includes summary.totalPurchases');
    expect(listRes.data?.summary?.totalVat !== undefined, 'Response includes summary.totalVat');
    expect(listRes.data?.pagination?.page === 1, 'Pagination default page is 1');

    // -----------------------------------------------------------------
    // 3. Purchase Creation & Decimal-Safe Calculations
    // -----------------------------------------------------------------
    console.log('\n📋 Test Group 3: Purchase Creation, Decimal Calculations & Auto-Supplier');
    const testInvNumber = `CGW-TEST-${Date.now().toString().slice(-5)}`;
    const createPayload = {
      supplierName: 'New Covent Garden Wholesale Ltd',
      supplierInvoiceNo: testInvNumber,
      date: '2026-10-18',
      status: 'Paid',
      notes: 'Morning wholesale procurement batch',
      items: [
        {
          product: 'Spanish Brown Onions',
          quantity: 50,
          unit: 'kg',
          unitCost: 1.20,
          vatRate: 0,
        },
        {
          product: 'Extra Virgin Olive Oil 5L',
          quantity: 10,
          unit: 'tins',
          unitCost: 20.00,
          vatRate: 20,
        },
      ],
    };

    // Expected:
    // item 1: 50 * 1.20 = 60.00, vat = 0
    // item 2: 10 * 20.00 = 200.00, vat = 40.00
    // subtotal = 260.00, vat = 40.00, total = 300.00

    const createRes = await request('POST', '/api/v1/purchases', {
      cookie: adminCookie,
      body: createPayload,
    });

    expect(createRes.status === 201, 'Purchase created successfully (201 Created)', `Status: ${createRes.status}`);
    const createdData = createRes.data?.data;
    if (createdData?.id) {
      createdPurchases.push(createdData.id);
    }

    expect(createdData?.purchaseNumber?.startsWith('PUR-2026-'), `Assigned valid sequence purchaseNumber: ${createdData?.purchaseNumber}`);
    expect(createdData?.subtotal === 260.00, `Subtotal accurately computed: £${createdData?.subtotal}`);
    expect(createdData?.vatAmount === 40.00, `VAT amount accurately computed: £${createdData?.vatAmount}`);
    expect(createdData?.total === 300.00, `Total accurately computed: £${createdData?.total}`);
    expect(createdData?.items?.length === 2, '2 line items persisted with full relations');

    // Verify auto-created supplier
    const suppliersRes = await request('GET', '/api/v1/purchases/suppliers', { cookie: adminCookie });
    expect(suppliersRes.status === 200, 'GET /purchases/suppliers returns 200 OK');
    const matchedSupplier = suppliersRes.data?.data?.find((s) => s.name === 'New Covent Garden Wholesale Ltd');
    expect(matchedSupplier !== undefined, 'Auto-created supplier present in suppliers catalog');
    if (matchedSupplier?.id) {
      createdSuppliers.push(matchedSupplier.id);
    }

    // -----------------------------------------------------------------
    // 4. Duplicate Supplier Invoice Protection
    // -----------------------------------------------------------------
    console.log('\n📋 Test Group 4: Duplicate Supplier Invoice Protection');
    const duplicateRes = await request('POST', '/api/v1/purchases', {
      cookie: adminCookie,
      body: {
        ...createPayload,
        items: [{ product: 'Potatoes', quantity: 10, unit: 'kg', unitCost: 1.0, vatRate: 0 }],
      },
    });

    expect(
      duplicateRes.status === 409,
      'Duplicate supplier invoice rejected with 409 Conflict',
      `Got status: ${duplicateRes.status}`
    );
    expect(
      duplicateRes.data?.code === 'DUPLICATE_SUPPLIER_INVOICE',
      `Error code is DUPLICATE_SUPPLIER_INVOICE (${duplicateRes.data?.code})`
    );

    // -----------------------------------------------------------------
    // 5. Purchase Retrieval, Update & Cancellation
    // -----------------------------------------------------------------
    console.log('\n📋 Test Group 5: Get Details, Update & Cancellation');
    const getRes = await request('GET', `/api/v1/purchases/${createdData.id}`, { cookie: adminCookie });
    expect(getRes.status === 200, 'GET /purchases/:id returns 200 OK');
    expect(getRes.data?.data?.items?.length === 2, 'Retrieved items match created bill');

    const updateRes = await request('PUT', `/api/v1/purchases/${createdData.id}`, {
      cookie: adminCookie,
      body: {
        status: 'Pending',
        notes: 'Payment terms renegotiated',
      },
    });
    expect(updateRes.status === 200, 'PUT /purchases/:id updates status to Pending');
    expect(updateRes.data?.data?.status === 'Pending', 'Persisted status is Pending');

    // Soft delete / cancel
    const cancelRes = await request('DELETE', `/api/v1/purchases/${createdData.id}`, { cookie: adminCookie });
    expect(cancelRes.status === 200, 'DELETE /purchases/:id soft cancels purchase (200 OK)');
    expect(cancelRes.data?.data?.status === 'Cancelled', 'Status updated to Cancelled');

    // -----------------------------------------------------------------
    // 6. Migration Preview & Batch Import
    // -----------------------------------------------------------------
    console.log('\n📋 Test Group 6: Migration Preview & Batch Import');
    const previewBatch = {
      purchases: [
        {
          supplierName: 'New Covent Garden Wholesale Ltd',
          supplierInvoiceNo: testInvNumber, // Existing duplicate!
          items: [{ product: 'Duplicate Produce', quantity: 5, unit: 'kg', unitCost: 2.0, vatRate: 0 }],
        },
        {
          supplierName: 'Evesham Organic Growers',
          supplierInvoiceNo: `EOG-${Date.now()}`,
          date: '2026-10-10',
          status: 'Paid',
          items: [{ product: 'Organic Leeks', quantity: 25, unit: 'kg', unitCost: 1.5, vatRate: 0 }],
        },
      ],
    };

    const previewRes = await request('POST', '/api/v1/purchases/import-preview', {
      cookie: adminCookie,
      body: previewBatch,
    });

    expect(previewRes.status === 200, 'POST /purchases/import-preview returns 200 OK');
    expect(previewRes.data?.data?.totalRecords === 2, 'Preview detected 2 total records');
    expect(previewRes.data?.data?.duplicatesCount === 1, 'Preview accurately detected 1 duplicate record');
    expect(previewRes.data?.data?.newRecordsCount === 1, 'Preview accurately detected 1 new record');

    // Execute Import
    const importRes = await request('POST', '/api/v1/purchases/import', {
      cookie: adminCookie,
      body: previewBatch,
    });

    expect(importRes.status === 200, 'POST /purchases/import executes successfully (200 OK)');
    expect(importRes.data?.data?.createdCount === 1, 'Imported exactly 1 new purchase into MySQL');
    expect(importRes.data?.data?.skippedCount === 1, 'Skipped exactly 1 duplicate purchase');

    // Track imported record for cleanup
    const importedPurchase = await prisma.purchase.findFirst({
      where: { supplierName: 'Evesham Organic Growers' },
    });
    if (importedPurchase) {
      createdPurchases.push(importedPurchase.id);
    }
    const importedSup = await prisma.supplier.findFirst({
      where: { name: 'Evesham Organic Growers' },
    });
    if (importedSup) {
      createdSuppliers.push(importedSup.id);
    }

  } catch (err) {
    console.error('Test suite uncaught error:', err);
    failed++;
  } finally {
    // -----------------------------------------------------------------
    // Cleanup verification artifacts
    // -----------------------------------------------------------------
    console.log('\n🧹 Cleaning up test artifacts...');
    for (const pId of createdPurchases) {
      await prisma.purchaseItem.deleteMany({ where: { purchaseId: pId } }).catch(() => {});
      await prisma.purchase.delete({ where: { id: pId } }).catch(() => {});
    }
    for (const sId of createdSuppliers) {
      await prisma.supplier.delete({ where: { id: sId } }).catch(() => {});
    }

    const finalPurchaseCount = await prisma.purchase.count();
    const finalSupplierCount = await prisma.supplier.count();

    expect(finalPurchaseCount === initialPurchaseCount, `Purchases count restored to baseline (${finalPurchaseCount})`);
    expect(finalSupplierCount === initialSupplierCount, `Suppliers count restored to baseline (${finalSupplierCount})`);

    console.log('\n====================================================');
    console.log(`Results: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runPurchasesSuite();
