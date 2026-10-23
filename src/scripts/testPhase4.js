import http from 'http';
import app from '../app.js';
import prisma from '../config/db.js';

let server;
let baseUrl;

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = options.headers || {};
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const status = res.status;
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { status, data };
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting LedgerFlow Phase 4 Verification Suite');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // Start test server on dynamic port
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  console.log(`Test server running on ${baseUrl}\n`);

  try {
    // ----------------------------------------------------
    // Step 0: Authenticate Admin, Accountant & Customer
    // ----------------------------------------------------
    console.log('📋 Setup: Authenticating Test Accounts');
    const adminLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'admin@freshharvest.co.uk', password: 'Password123!' },
    });
    const adminToken = adminLogin.data?.token;

    const accountantLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'accounts@freshharvest.co.uk', password: 'Password123!' },
    });
    const accountantToken = accountantLogin.data?.token;

    const customerLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'accounts@greenvalley.co.uk', password: 'Password123!' },
    });
    const customerToken = customerLogin.data?.token;

    assert(adminToken && accountantToken && customerToken, 'Successfully authenticated admin, accountant, and customer');

    // ----------------------------------------------------
    // Test Group 1: Invoice Creation, Calculation & Sequential Numbers
    // ----------------------------------------------------
    console.log('\n📋 Test Group 1: Invoice Creation & Mathematical Precision');

    // Create an active invoice with produce (0% VAT) and olive oil (20% VAT)
    // Item 1: 40 kg Tomatoes @ £3.20 = £128.00 (VAT 0% = £0.00) => £128.00
    // Item 2: 2 tins Olive Oil @ £25.00 = £50.00 (VAT 20% = £10.00) => £60.00
    // Subtotal: £178.00, VAT: £10.00, Total: £188.00
    const createInv1 = await request('/api/v1/invoices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerId: 'CUST-001',
        reference: 'PO-TEST-101',
        status: 'Sent',
        items: [
          { productId: 'PROD-001', description: 'Vine Tomatoes', quantity: 40, unit: 'kg', unitPrice: 3.20, vatRate: 0 },
          { description: 'Olive Oil 5L', quantity: 2, unit: 'tins', unitPrice: 25.00, vatRate: 20 },
        ],
      },
    });

    assert(createInv1.status === 201, 'Admin creates invoice with multi-VAT items (201 Created)');
    const inv1 = createInv1.data?.data;
    assert(inv1?.invoiceNumber && inv1.invoiceNumber.startsWith('INV-'), `Assigned sequential invoice number '${inv1?.invoiceNumber}'`);
    assert(parseFloat(inv1?.subtotal) === 178.00, `Subtotal accurately calculated: £${inv1?.subtotal} == £178.00`);
    assert(parseFloat(inv1?.vatAmount) === 10.00, `VAT accurately calculated: £${inv1?.vatAmount} == £10.00`);
    assert(parseFloat(inv1?.total) === 188.00, `Total accurately calculated: £${inv1?.total} == £188.00`);
    assert(parseFloat(inv1?.balanceDue) === 188.00, `Initial balance due equals total: £${inv1?.balanceDue}`);

    // Create second invoice immediately to verify sequential numbering
    const createInv2 = await request('/api/v1/invoices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accountantToken}` },
      body: {
        customerId: 'CUST-002',
        reference: 'PO-TEST-102',
        status: 'Sent',
        items: [
          { description: 'English Cucumbers', quantity: 50, unit: 'units', unitPrice: 1.00, vatRate: 0 },
        ],
      },
    });
    assert(createInv2.status === 201, 'Accountant can create invoice (201 Created)');
    const inv2 = createInv2.data?.data;
    assert(inv2?.invoiceNumber !== inv1?.invoiceNumber, `Sequential numbers are distinct: ${inv1?.invoiceNumber} -> ${inv2?.invoiceNumber}`);

    // Validation checks
    const badCustInv = await request('/api/v1/invoices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerId: 'CUST-NONEXISTENT',
        items: [{ description: 'Test Item', quantity: 1, unitPrice: 10 }],
      },
    });
    assert(badCustInv.status === 400 && badCustInv.data?.code === 'INVALID_CUSTOMER_ID', 'Rejects non-existent customer ID (400 INVALID_CUSTOMER_ID)');

    const badQtyInv = await request('/api/v1/invoices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerId: 'CUST-001',
        items: [{ description: 'Test Item', quantity: -5, unitPrice: 10 }],
      },
    });
    assert(badQtyInv.status === 400 && badQtyInv.data?.code === 'VALIDATION_ERROR', 'Rejects negative item quantity with 400 VALIDATION_ERROR');

    // ----------------------------------------------------
    // Test Group 2: Draft Lifecycle & Immutability of Finalized Invoices
    // ----------------------------------------------------
    console.log('\n📋 Test Group 2: Draft Invoices & Immutability Rules');

    // Create a Draft invoice
    const createDraft = await request('/api/v1/invoices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerId: 'CUST-001',
        status: 'Draft',
        reference: 'DRAFT-PO-99',
        items: [{ description: 'Initial Draft Produce', quantity: 10, unitPrice: 5.00, vatRate: 0 }],
      },
    });
    assert(createDraft.status === 201 && createDraft.data?.data?.status === 'Draft', 'Admin creates draft invoice');
    const draftInv = createDraft.data?.data;

    // Update the Draft invoice
    const updateDraft = await request(`/api/v1/invoices/${draftInv.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        reference: 'DRAFT-PO-UPDATED',
        items: [{ description: 'Revised Draft Produce', quantity: 20, unitPrice: 5.00, vatRate: 0 }],
      },
    });
    assert(updateDraft.status === 200 && parseFloat(updateDraft.data?.data?.total) === 100.00, 'Draft invoice updated with recalculated totals (200 OK)');

    // Attempt to edit a finalized (Sent) invoice: Must be REJECTED!
    const editFinalized = await request(`/api/v1/invoices/${inv1.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        items: [{ description: 'Illegal Modification', quantity: 99, unitPrice: 99 }],
      },
    });
    assert(
      editFinalized.status === 409 && editFinalized.data?.code === 'CANNOT_EDIT_FINALIZED_INVOICE',
      'Safety rule: Editing a finalized invoice is strictly rejected (409 CANNOT_EDIT_FINALIZED_INVOICE)'
    );

    // Finalize the Draft invoice
    const finalizeRes = await request(`/api/v1/invoices/${draftInv.id}/finalize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      finalizeRes.status === 200 && finalizeRes.data?.data?.status === 'Sent' && parseFloat(finalizeRes.data?.data?.balanceDue) === 100.00,
      'Finalize endpoint promotes draft to Sent and activates balance due (200 OK)'
    );

    // Cannot re-finalize
    const reFinalize = await request(`/api/v1/invoices/${draftInv.id}/finalize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(reFinalize.status === 409 && reFinalize.data?.code === 'INVOICE_ALREADY_FINALIZED', 'Re-finalizing is rejected with 409 Conflict');

    // ----------------------------------------------------
    // Test Group 3: Invoice Cancellation & Auditable Voiding
    // ----------------------------------------------------
    console.log('\n📋 Test Group 3: Auditable Invoice Voiding');

    const voidRes = await request(`/api/v1/invoices/${draftInv.id}/void`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { reason: 'Order cancelled by customer before dispatch.' },
    });
    assert(
      voidRes.status === 200 &&
      voidRes.data?.data?.status === 'Void' &&
      parseFloat(voidRes.data?.data?.balanceDue) === 0.00 &&
      voidRes.data?.data?.voidReason === 'Order cancelled by customer before dispatch.',
      'Invoice successfully voided with recorded audit reason and zeroed balance due (200 OK)'
    );

    // ----------------------------------------------------
    // Test Group 4: Payment Management, Atomic Allocations & Idempotency
    // ----------------------------------------------------
    console.log('\n📋 Test Group 4: Payments, Allocations & Idempotency');

    // Payment 1: Partial payment of £88.00 on inv1 (£188.00 total)
    const idempotencyToken = `IDEMP-${Date.now()}`;
    const pay1Res = await request('/api/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerId: 'CUST-001',
        amount: 88.00,
        paymentMethod: 'Bank Transfer',
        reference: 'BACS-TEST-88',
        idempotencyKey: idempotencyToken,
        allocations: [{ invoiceId: inv1.id, amount: 88.00 }],
      },
    });

    assert(pay1Res.status === 201, 'Admin records partial payment of £88.00 (201 Created)');
    const pay1 = pay1Res.data?.data;
    assert(pay1?.paymentNumber && pay1.paymentNumber.startsWith('PAY-'), `Assigned sequential payment number '${pay1?.paymentNumber}'`);

    // Verify invoice status updated to Partially Paid
    const checkInv1Partial = await request(`/api/v1/invoices/${inv1.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      checkInv1Partial.data?.data?.status === 'Partially Paid' &&
      parseFloat(checkInv1Partial.data?.data?.amountPaid) === 88.00 &&
      parseFloat(checkInv1Partial.data?.data?.balanceDue) === 100.00,
      'Invoice status transitioned to Partially Paid with balance due £100.00'
    );

    // Idempotency: Re-submitting the exact same payment request returns existing record
    const idempRes = await request('/api/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerId: 'CUST-001',
        amount: 88.00,
        idempotencyKey: idempotencyToken,
      },
    });
    assert(idempRes.status === 200 && idempRes.data?.isDuplicate === true, 'Idempotent request safely returns original payment without double-crediting');

    // Overpayment check: Attempting to pay £150 on an invoice with £100 balance due must be REJECTED!
    const overpayRes = await request('/api/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerId: 'CUST-001',
        amount: 150.00,
        allocations: [{ invoiceId: inv1.id, amount: 150.00 }],
      },
    });
    assert(
      overpayRes.status === 400 && overpayRes.data?.code === 'OVERPAYMENT_NOT_ALLOWED',
      'Overpayment check: Rejects allocating £150 to £100 balance with 400 OVERPAYMENT_NOT_ALLOWED'
    );

    // Payment 2: Remaining £100 to settle inv1 in full
    const pay2Res = await request('/api/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accountantToken}` },
      body: {
        customerId: 'CUST-001',
        amount: 100.00,
        paymentMethod: 'Bank Transfer',
        reference: 'BACS-SETTLE-100',
        allocations: [{ invoiceId: inv1.id, amount: 100.00 }],
      },
    });
    assert(pay2Res.status === 201, 'Accountant records remaining payment of £100 (201 Created)');

    // Verify invoice status updated to Paid
    const checkInv1Paid = await request(`/api/v1/invoices/${inv1.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      checkInv1Paid.data?.data?.status === 'Paid' &&
      parseFloat(checkInv1Paid.data?.data?.amountPaid) === 188.00 &&
      parseFloat(checkInv1Paid.data?.data?.balanceDue) === 0.00,
      'Invoice fully settled: status is Paid, balance due is £0.00'
    );

    // Unallocated Payment: Record payment with no invoice allocation (credit on account)
    const unallocPay = await request('/api/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        customerId: 'CUST-001',
        amount: 50.00,
        reference: 'CREDIT-DEPOSIT-50',
      },
    });
    assert(
      unallocPay.status === 201 && parseFloat(unallocPay.data?.data?.unallocatedAmount) === 50.00,
      'Unallocated payment stored cleanly as on-account credit (unallocatedAmount: £50.00)'
    );
    const unallocPaymentId = unallocPay.data?.data?.id;

    // ----------------------------------------------------
    // Test Group 5: Payment Voiding & Balance Reversal
    // ----------------------------------------------------
    console.log('\n📋 Test Group 5: Payment Reversal & Invoice Balance Restoration');

    // Void pay2 (£100 settlement). Must restore inv1 balance due back to £100 and status to Partially Paid!
    const voidPayRes = await request(`/api/v1/payments/${pay2Res.data?.data?.id}/void`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { reason: 'Bounced bank transfer notification.' },
    });
    assert(voidPayRes.status === 200 && voidPayRes.data?.data?.status === 'Voided', 'Payment voided with 200 OK');

    const checkRestoredInv = await request(`/api/v1/invoices/${inv1.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      checkRestoredInv.data?.data?.status === 'Partially Paid' &&
      parseFloat(checkRestoredInv.data?.data?.amountPaid) === 88.00 &&
      parseFloat(checkRestoredInv.data?.data?.balanceDue) === 100.00,
      'Payment reversal atomically restored invoice balance due to £100.00 and status to Partially Paid'
    );

    // ----------------------------------------------------
    // Test Group 6: Customer Balance & Statement Calculation
    // ----------------------------------------------------
    console.log('\n📋 Test Group 6: Customer Statement & Running Balance');

    const statementRes = await request('/api/v1/customers/CUST-001/statement', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(statementRes.status === 200, 'Admin retrieves customer statement (200 OK)');
    const stmt = statementRes.data?.data;

    // CUST-001 baseline (from verified seed):
    // Opening Balance = £2360.50
    // Active Invoices: inv1 (£188.00) (draftInv is Void, so it adds £0.00)
    // Active Completed Payments: pay1 (£88.00), unallocPay (£50.00) (pay2 was Voided, so it deducts £0.00)
    // Expected Current Outstanding: 2360.50 + 188.00 - (88.00 + 50.00) = £2410.50
    assert(parseFloat(stmt?.summary?.openingBalance) === 2360.50, `Opening balance included exactly once: £${stmt?.summary?.openingBalance}`);
    assert(parseFloat(stmt?.summary?.totalInvoiced) === 188.00, `Total active invoiced: £${stmt?.summary?.totalInvoiced}`);
    assert(parseFloat(stmt?.summary?.totalPaid) === 138.00, `Total active payments: £${stmt?.summary?.totalPaid}`);
    assert(
      parseFloat(stmt?.summary?.currentOutstandingBalance) === 2410.50,
      `Current outstanding balance accurately reconciled: £${stmt?.summary?.currentOutstandingBalance} == £2410.50`
    );

    // ----------------------------------------------------
    // Test Group 7: Customer Isolation & Security
    // ----------------------------------------------------
    console.log('\n📋 Test Group 7: Customer Isolation & Role Security');

    // Customer lists invoices: must only see CUST-001 invoices
    const custInvoicesRes = await request('/api/v1/invoices', {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(
      custInvoicesRes.status === 200 && custInvoicesRes.data?.data?.every((i) => i.customerId === 'CUST-001'),
      'Customer role invoice list is strictly scoped to own account'
    );

    // Customer accessing own invoice:
    const custGetOwnInv = await request(`/api/v1/invoices/${inv1.id}`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(custGetOwnInv.status === 200, 'Customer accesses own invoice with 200 OK');

    // Customer accessing another customer's invoice (inv2 belongs to CUST-002):
    const custGetOtherInv = await request(`/api/v1/invoices/${inv2.id}`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(
      custGetOtherInv.status === 403 && custGetOtherInv.data?.code === 'CUSTOMER_ISOLATION_VIOLATION',
      'Customer isolation: Blocked from accessing other customer invoice with 403 Forbidden'
    );

    // Customer accessing own statement:
    const custGetOwnStmt = await request('/api/v1/customers/CUST-001/statement', {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(custGetOwnStmt.status === 200, 'Customer successfully views own financial statement');

    // Customer accessing other customer statement:
    const custGetOtherStmt = await request('/api/v1/customers/CUST-002/statement', {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(
      custGetOtherStmt.status === 403 && custGetOtherStmt.data?.code === 'CUSTOMER_ISOLATION_VIOLATION',
      'Customer isolation: Blocked from other customer statement with 403 Forbidden'
    );

    // Customer attempting to create invoice:
    const custCreateInv = await request('/api/v1/invoices', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerToken}` },
      body: { customerId: 'CUST-001', items: [{ description: 'Illegal Item', quantity: 1, unitPrice: 10 }] },
    });
    assert(custCreateInv.status === 403, 'Customer role is FORBIDDEN (403) from creating invoices');

    // Customer attempting to record payment:
    const custRecordPay = await request('/api/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerToken}` },
      body: { customerId: 'CUST-001', amount: 50 },
    });
    assert(custRecordPay.status === 403, 'Customer role is FORBIDDEN (403) from recording payments');

    // ----------------------------------------------------
    // Test Group 8: Foreign Key & Safe Deletion Enforcement
    // ----------------------------------------------------
    console.log('\n📋 Test Group 8: Relational Integrity & Safe Deletion Constraints');

    // Cannot delete customer with invoice records
    const deleteCustWithInvoices = await request('/api/v1/customers/CUST-001?hard=true', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      deleteCustWithInvoices.status === 409 && deleteCustWithInvoices.data?.code === 'CUSTOMER_HAS_LINKED_USERS',
      'Safe deletion: Cannot delete customer with linked users / invoices (409 Conflict)'
    );

    // Cannot delete product referenced in historical invoice line items (PROD-001 in inv1)
    const deleteProdWithInvoices = await request('/api/v1/products/PROD-001?hard=true', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      deleteProdWithInvoices.status === 409 && deleteProdWithInvoices.data?.code === 'PRODUCT_HAS_INVOICE_RECORDS',
      'Safe deletion: Cannot delete product referenced in historical invoices (409 Conflict)'
    );

    // Cannot hard delete finalized invoice
    const deleteFinalizedInv = await request(`/api/v1/invoices/${inv1.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      deleteFinalizedInv.status === 409 && deleteFinalizedInv.data?.code === 'CANNOT_DELETE_FINALIZED_INVOICE',
      'Safe deletion: Cannot delete finalized invoice (must be voided instead) (409 Conflict)'
    );

    // ----------------------------------------------------
    // Clean up temporary Phase 4 test records
    // ----------------------------------------------------
    console.log('\n📋 Cleanup: Removing Temporary Phase 4 Test Entities');
    // Delete payments allocations and payments
    await prisma.paymentAllocation.deleteMany({
      where: { paymentId: { in: [pay1.id, pay2Res.data?.data?.id, unallocPaymentId] } },
    });
    await prisma.payment.deleteMany({
      where: { id: { in: [pay1.id, pay2Res.data?.data?.id, unallocPaymentId] } },
    });
    // Delete test invoice items and invoices
    await prisma.invoiceItem.deleteMany({
      where: { invoiceId: { in: [inv1.id, inv2.id, draftInv.id] } },
    });
    await prisma.invoice.deleteMany({
      where: { id: { in: [inv1.id, inv2.id, draftInv.id] } },
    });
    console.log('  ✅ Temporary test records cleanly removed.');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    if (server) {
      server.close();
    }
    await prisma.$disconnect();
  }

  console.log('\n====================================================');
  console.log(`📊 Phase 4 Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
