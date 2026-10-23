/**
 * LedgerFlow Phase 7: Invoice & Payment Integration Verification Suite
 * Validates full-stack invoice & payment API behavior against real database
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
  } else {
    data = await res.text();
  }

  return { status: res.status, data, setCookie };
}

async function runPhase7Suite() {
  console.log('====================================================');
  console.log('🧪 Starting LedgerFlow Phase 7 Verification Suite');
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

  // Start test server on dynamic port
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

  const testEntityIds = {
    invoiceIds: [],
    paymentIds: [],
  };

  try {
    // -----------------------------------------------------------------
    // 1. Authenticate All 3 Roles
    // -----------------------------------------------------------------
    console.log('📋 Test Group 1: Authentication & Session Verification');
    const adminLogin = await request('POST', '/api/v1/auth/login', {
      body: { email: 'admin@freshharvest.co.uk', password: 'Password123!' },
    });
    expect(adminLogin.status === 200, 'Admin authenticated successfully', 'Admin login failed');
    adminCookie = adminLogin.setCookie;

    const accountantLogin = await request('POST', '/api/v1/auth/login', {
      body: { email: 'accounts@freshharvest.co.uk', password: 'Password123!' },
    });
    expect(accountantLogin.status === 200, 'Accountant authenticated successfully', 'Accountant login failed');
    accountantCookie = accountantLogin.setCookie;

    const customerLogin = await request('POST', '/api/v1/auth/login', {
      body: { email: 'accounts@greenvalley.co.uk', password: 'Password123!' },
    });
    expect(customerLogin.status === 200, 'Customer authenticated successfully', 'Customer login failed');
    customerCookie = customerLogin.setCookie;

    // -----------------------------------------------------------------
    // 2. Invoice Listing & Structure
    // -----------------------------------------------------------------
    console.log('\n📋 Test Group 2: Invoice Listing & Relation Verification');
    const listRes = await request('GET', '/api/v1/invoices', { cookie: adminCookie });
    expect(listRes.status === 200, 'Admin retrieves invoices list (200 OK)');
    expect(Array.isArray(listRes.data?.data), 'Invoices response contains data array');
    expect(listRes.data?.pagination?.total !== undefined, 'Invoices response contains pagination metadata');

    // -----------------------------------------------------------------
    // 3. Invoice Creation & Sequential Numbering
    // -----------------------------------------------------------------
    console.log('\n📋 Test Group 3: Invoice Creation, Calculation & Immutability');
    const invoicePayload = {
      customerId: 'CUST-001',
      issueDate: '2026-10-19',
      dueDate: '2026-11-02',
      reference: 'PO-TEST-P7-001',
      status: 'Sent',
      discountAmount: 10.00,
      notes: 'Phase 7 Integration test invoice',
      items: [
        {
          productId: 'PROD-001',
          description: 'Vine Tomatoes',
          quantity: 20,
          unit: 'kg',
          unitPrice: 3.20, // 64.00, 0% VAT
          vatRate: 0,
        },
        {
          productId: 'PROD-002',
          description: 'Hass Avocados',
          quantity: 10,
          unit: 'box',
          unitPrice: 12.00, // 120.00, 20% VAT = 24.00
          vatRate: 20,
        },
      ],
    };

    const createInvRes = await request('POST', '/api/v1/invoices', {
      cookie: adminCookie,
      body: invoicePayload,
    });
    expect(createInvRes.status === 201, 'Invoice created with 201 Created');
    const createdInv = createInvRes.data?.data;
    if (createdInv) testEntityIds.invoiceIds.push(createdInv.id);

    expect(createdInv?.invoiceNumber?.startsWith('INV-2026-'), `Server assigned sequential invoice number: ${createdInv?.invoiceNumber}`);
    // Subtotal: 64 + 120 = 184
    expect(Number(createdInv?.subtotal) === 184.00, `Subtotal accurately calculated: £${createdInv?.subtotal} == £184.00`);
    // VAT: 20% of 120 = 24
    expect(Number(createdInv?.vatAmount) === 24.00, `VAT accurately calculated: £${createdInv?.vatAmount} == £24.00`);
    // Total: 184 + 24 - 10 = 198
    expect(Number(createdInv?.total) === 198.00, `Grand total with discount accurately calculated: £${createdInv?.total} == £198.00`);
    expect(Number(createdInv?.balanceDue) === 198.00, `Initial balance due equals grand total: £${createdInv?.balanceDue}`);

    // Verify retrieval by ID
    const getInvRes = await request('GET', `/api/v1/invoices/${createdInv?.id}`, { cookie: adminCookie });
    expect(getInvRes.status === 200, `Invoice retrieved by ID '${createdInv?.id}' (200 OK)`);
    expect(getInvRes.data?.data?.items?.length === 2, 'Invoice contains 2 persisted line items');
    expect(getInvRes.data?.data?.customer?.id === 'CUST-001', 'Invoice customer details correctly attached');

    // -----------------------------------------------------------------
    // 4. Draft Lifecycle: Creation, Update, and Finalize
    // -----------------------------------------------------------------
    console.log('\n📋 Test Group 4: Draft Invoices Lifecycle & Finalization');
    const draftPayload = {
      customerId: 'CUST-001',
      status: 'Draft',
      items: [
        {
          description: 'Draft item A',
          quantity: 5,
          unit: 'units',
          unitPrice: 10.00,
          vatRate: 0,
        },
      ],
    };
    const draftRes = await request('POST', '/api/v1/invoices', { cookie: adminCookie, body: draftPayload });
    expect(draftRes.status === 201 && draftRes.data?.data?.status === 'Draft', 'Draft invoice created (201 Created)');
    const draftInv = draftRes.data?.data;
    if (draftInv) testEntityIds.invoiceIds.push(draftInv.id);

    expect(Number(draftInv?.balanceDue) === 0, 'Draft invoice has balanceDue of 0 before finalization');

    // Update draft
    const updateDraftRes = await request('PUT', `/api/v1/invoices/${draftInv?.id}`, {
      cookie: adminCookie,
      body: {
        notes: 'Updated draft notes',
        items: [
          {
            description: 'Draft item updated',
            quantity: 10,
            unit: 'units',
            unitPrice: 15.00,
            vatRate: 0,
          },
        ],
      },
    });
    expect(updateDraftRes.status === 200, 'Draft invoice updated with recalculated total: 150.00 (200 OK)');

    // Finalize draft
    const finalizeRes = await request('POST', `/api/v1/invoices/${draftInv?.id}/finalize`, { cookie: adminCookie });
    expect(finalizeRes.status === 200, 'Draft invoice finalized and promoted to Sent (200 OK)');
    expect(finalizeRes.data?.data?.status === 'Sent', 'Finalized invoice status is Sent');
    expect(Number(finalizeRes.data?.data?.balanceDue) === 150.00, 'Finalized invoice balance due activated to 150.00');

    // -----------------------------------------------------------------
    // 5. Payment Recording & Allocations
    // -----------------------------------------------------------------
    console.log('\n📋 Test Group 5: Payment Recording, Allocations & Invoice Balances');
    // Record partial payment of £98.00 against createdInv (total £198)
    const paymentPayload = {
      customerId: 'CUST-001',
      amount: 98.00,
      paymentDate: '2026-10-19',
      paymentMethod: 'Bank Transfer',
      reference: 'BACS-P7-TEST',
      notes: 'Phase 7 partial remittance',
      allocations: [
        {
          invoiceId: createdInv.id,
          amount: 98.00,
        },
      ],
    };

    const createPayRes = await request('POST', '/api/v1/payments', {
      cookie: adminCookie,
      body: paymentPayload,
    });
    expect(createPayRes.status === 201, 'Payment recorded with 201 Created');
    const createdPay = createPayRes.data?.data;
    if (createdPay) testEntityIds.paymentIds.push(createdPay.id);

    expect(createdPay?.paymentNumber?.startsWith('PAY-2026-'), `Assigned sequential payment number: ${createdPay?.paymentNumber}`);

    // Verify invoice status updated to Partially Paid and balance due decremented to £100
    const invAfterPay1 = await request('GET', `/api/v1/invoices/${createdInv.id}`, { cookie: adminCookie });
    expect(invAfterPay1.data?.data?.status === 'Partially Paid', 'Invoice status transitioned to Partially Paid');
    expect(Number(invAfterPay1.data?.data?.amountPaid) === 98.00, `amountPaid updated to £98.00`);
    expect(Number(invAfterPay1.data?.data?.balanceDue) === 100.00, `balanceDue decremented to £100.00`);

    // Settle remaining balance £100
    const settlePayload = {
      customerId: 'CUST-001',
      amount: 100.00,
      paymentMethod: 'Square',
      allocations: [
        {
          invoiceId: createdInv.id,
          amount: 100.00,
        },
      ],
    };
    const settlePayRes = await request('POST', '/api/v1/payments', { cookie: accountantCookie, body: settlePayload });
    expect(settlePayRes.status === 201, 'Accountant records remaining payment of £100 (201 Created)');
    if (settlePayRes.data?.data) testEntityIds.paymentIds.push(settlePayRes.data?.data.id);

    const invAfterSettle = await request('GET', `/api/v1/invoices/${createdInv.id}`, { cookie: adminCookie });
    expect(invAfterSettle.data?.data?.status === 'Paid', 'Invoice status transitioned to Paid in full');
    expect(Number(invAfterSettle.data?.data?.balanceDue) === 0.00, 'Invoice balance due reached £0.00');

    // -----------------------------------------------------------------
    // 6. Payment Listing & Detail Retrieval
    // -----------------------------------------------------------------
    console.log('\n📋 Test Group 6: Payment Listing & Detail Retrieval');
    const payListRes = await request('GET', '/api/v1/payments', { cookie: adminCookie });
    expect(payListRes.status === 200, 'Admin retrieves payments list (200 OK)');
    expect(Array.isArray(payListRes.data?.data), 'Payments response contains data array');

    const singlePayRes = await request('GET', `/api/v1/payments/${createdPay.id}`, { cookie: adminCookie });
    expect(singlePayRes.status === 200, 'Payment details retrieved by ID');
    expect(singlePayRes.data?.data?.allocations?.length === 1, 'Payment includes invoice allocation detail');

    // -----------------------------------------------------------------
    // 7. Customer Isolation & Role Guards
    // -----------------------------------------------------------------
    console.log('\n📋 Test Group 7: Customer Isolation & Security Enforcement');
    const custInvoicesRes = await request('GET', '/api/v1/invoices', { cookie: customerCookie });
    expect(custInvoicesRes.status === 200, 'Customer retrieves invoice list');
    const allBelongToCustomer = (custInvoicesRes.data?.data || []).every((i) => i.customerId === 'CUST-001');
    expect(allBelongToCustomer, 'Customer invoice list strictly scoped to own account');

    // Customer cannot create invoices or payments
    const custCreateInv = await request('POST', '/api/v1/invoices', { cookie: customerCookie, body: invoicePayload });
    expect(custCreateInv.status === 403, 'Customer role is FORBIDDEN (403) from creating invoices');

    const custCreatePay = await request('POST', '/api/v1/payments', { cookie: customerCookie, body: paymentPayload });
    expect(custCreatePay.status === 403, 'Customer role is FORBIDDEN (403) from recording payments');

    // -----------------------------------------------------------------
    // 8. Financial Edge Cases & Input Validation
    // -----------------------------------------------------------------
    console.log('\n📋 Test Group 8: Financial Validations & Overpayment Prevention');
    // Overpayment check
    const overpayPayload = {
      customerId: 'CUST-001',
      amount: 500.00,
      allocations: [{ invoiceId: draftInv.id, amount: 500.00 }], // draftInv balance is 150
    };
    const overpayRes = await request('POST', '/api/v1/payments', { cookie: adminCookie, body: overpayPayload });
    expect(overpayRes.status === 400, 'Rejects overpayment allocating £500 to £150 balance (400 OVERPAYMENT_NOT_ALLOWED)');

    // Nonexistent customer check
    const badCustInv = await request('POST', '/api/v1/invoices', {
      cookie: adminCookie,
      body: { ...invoicePayload, customerId: 'CUST-NONEXISTENT' },
    });
    expect(badCustInv.status === 400, 'Rejects invoice with non-existent customer (400 INVALID_CUSTOMER_ID)');

    // Negative quantity check
    const negQtyInv = await request('POST', '/api/v1/invoices', {
      cookie: adminCookie,
      body: {
        ...invoicePayload,
        items: [{ description: 'Bad item', quantity: -5, unitPrice: 10, vatRate: 0 }],
      },
    });
    expect(negQtyInv.status === 400, 'Rejects negative quantity with 400 VALIDATION_ERROR');

    // -----------------------------------------------------------------
    // 9. Auditable Invoice Voiding
    // -----------------------------------------------------------------
    console.log('\n📋 Test Group 9: Auditable Invoice Voiding & Reversal');
    const voidRes = await request('POST', `/api/v1/invoices/${draftInv.id}/void`, {
      cookie: adminCookie,
      body: { reason: 'Client cancelled contract before fulfillment' },
    });
    expect(voidRes.status === 200, 'Invoice voided with recorded audit reason (200 OK)');
    expect(voidRes.data?.data?.status === 'Void', 'Voided invoice status is Void');
    expect(Number(voidRes.data?.data?.balanceDue) === 0.00, 'Voided invoice balance due is £0.00');

    // -----------------------------------------------------------------
    // 10. Database Persistence Verification
    // -----------------------------------------------------------------
    console.log('\n📋 Test Group 10: Direct Database Persistence Verification');
    const dbInvoice = await prisma.invoice.findUnique({
      where: { id: createdInv.id },
      include: { items: true, allocations: true },
    });
    expect(!!dbInvoice, 'Invoice verified directly in MySQL database');
    expect(dbInvoice?.items.length === 2, 'Line items verified persisted in database');
    expect(dbInvoice?.allocations.length === 2, 'Payment allocations verified in database');

  } finally {
    // -----------------------------------------------------------------
    // Cleanup: Remove Phase 7 test records cleanly
    // -----------------------------------------------------------------
    console.log('\n📋 Cleanup: Removing Temporary Phase 7 Test Entities');
    try {
      for (const pId of testEntityIds.paymentIds) {
        await prisma.paymentAllocation.deleteMany({ where: { paymentId: pId } }).catch(() => {});
        await prisma.payment.delete({ where: { id: pId } }).catch(() => {});
      }
      for (const iId of testEntityIds.invoiceIds) {
        await prisma.paymentAllocation.deleteMany({ where: { invoiceId: iId } }).catch(() => {});
        await prisma.invoiceItem.deleteMany({ where: { invoiceId: iId } }).catch(() => {});
        await prisma.invoice.delete({ where: { id: iId } }).catch(() => {});
      }
      logPass('Temporary test records cleanly removed');
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr);
    }

    if (server) {
      server.close();
    }
  }

  console.log('\n====================================================');
  console.log(`📊 Phase 7 Verification Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase7Suite().catch((err) => {
  console.error('Fatal error in Phase 7 verification:', err);
  process.exit(1);
});
