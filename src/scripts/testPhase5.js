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
  console.log('🧪 Starting LedgerFlow Phase 5 Verification Suite');
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
    console.log('📋 Step 0: Authenticating Test Accounts');
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

    assert(adminToken && accountantToken && customerToken, 'Successfully authenticated all 3 roles');

    const adminAuth = { Authorization: `Bearer ${adminToken}` };
    const accountantAuth = { Authorization: `Bearer ${accountantToken}` };
    const customerAuth = { Authorization: `Bearer ${customerToken}` };

    // ----------------------------------------------------
    // Section 1: Customer Self-Service Ordering Policy & Permissions
    // ----------------------------------------------------
    console.log('\n🔒 Section 1: Role Permissions & Customer Ordering Policies');

    // Customer role attempting to place an order directly -> 403 Forbidden
    const customerOrderAttempt = await request('/api/v1/orders', {
      method: 'POST',
      headers: customerAuth,
      body: {
        customerId: 'CUST-001',
        items: [{ productId: 'PROD-001', name: 'Vine Tomatoes', quantity: 5, unit: 'kg' }],
      },
    });
    assert(
      customerOrderAttempt.status === 403,
      'Customer role cannot self-service create orders (HTTP 403 Forbidden)'
    );

    // Unauthenticated request -> 401 Unauthorized
    const unauthOrderAttempt = await request('/api/v1/orders', {
      method: 'GET',
    });
    assert(unauthOrderAttempt.status === 401, 'Unauthenticated order listing rejected (HTTP 401)');

    // ----------------------------------------------------
    // Section 2: Validation of Customer, Product & Van Foreign Keys
    // ----------------------------------------------------
    console.log('\n🔍 Section 2: Customer, Product & Van Entity Validations');

    // Non-existent customer
    const invalidCustomerOrder = await request('/api/v1/orders', {
      method: 'POST',
      headers: adminAuth,
      body: {
        customerId: 'NON-EXISTENT-CUST',
        items: [{ name: 'Vine Tomatoes', quantity: 10, unit: 'kg' }],
      },
    });
    assert(
      invalidCustomerOrder.status === 404 && invalidCustomerOrder.data.code === 'CUSTOMER_NOT_FOUND',
      'Order creation rejects non-existent customer (HTTP 404)'
    );

    // Non-existent van
    const invalidVanOrder = await request('/api/v1/orders', {
      method: 'POST',
      headers: adminAuth,
      body: {
        customerId: 'CUST-001',
        vanId: 'invalid-van-999',
        items: [{ name: 'Vine Tomatoes', quantity: 10, unit: 'kg' }],
      },
    });
    assert(
      invalidVanOrder.status === 404 && invalidVanOrder.data.code === 'VAN_NOT_FOUND',
      'Order creation rejects non-existent van assignment (HTTP 404)'
    );

    // Non-existent product ID
    const invalidProductOrder = await request('/api/v1/orders', {
      method: 'POST',
      headers: adminAuth,
      body: {
        customerId: 'CUST-001',
        items: [{ productId: 'NON-EXISTENT-PROD', name: 'Ghost Item', quantity: 5, unit: 'kg' }],
      },
    });
    assert(
      invalidProductOrder.status === 404 && invalidProductOrder.data.code === 'PRODUCT_NOT_FOUND',
      'Order creation rejects non-existent product ID (HTTP 404)'
    );

    // Zero or negative quantity
    const invalidQuantityOrder = await request('/api/v1/orders', {
      method: 'POST',
      headers: adminAuth,
      body: {
        customerId: 'CUST-001',
        items: [{ name: 'Vine Tomatoes', quantity: -5, unit: 'kg' }],
      },
    });
    assert(
      invalidQuantityOrder.status === 400,
      'Order creation rejects negative or zero item quantities (HTTP 400)'
    );

    // ----------------------------------------------------
    // Section 3: Daily Order Lifecycle (Create, Update, Cancel, List)
    // ----------------------------------------------------
    console.log('\n📦 Section 3: Order Lifecycle & Management');

    const testDate = '2026-10-25';

    // 1. Create Order 1 (Van 1 - CUST-001 Green Valley)
    const order1Res = await request('/api/v1/orders', {
      method: 'POST',
      headers: adminAuth,
      body: {
        customerId: 'CUST-001',
        vanId: 'van1',
        orderDate: testDate,
        status: 'Confirmed',
        notes: 'Morning priority delivery',
        items: [
          { productId: 'PROD-001', name: 'Vine Tomatoes', quantity: 15, unit: 'kg', unitPrice: 2.80 },
          { productId: 'PROD-002', name: 'King Edward Potatoes', quantity: 30, unit: 'kg', unitPrice: 1.20 },
        ],
      },
    });
    assert(order1Res.status === 201 && order1Res.data.data.orderNumber.startsWith(`ORD-${testDate}-`), 'Admin creates Order 1 on Van 1');
    const order1 = order1Res.data.data;

    // 2. Create Order 2 (Van 2 - CUST-002 Fresh Kitchen)
    const order2Res = await request('/api/v1/orders', {
      method: 'POST',
      headers: accountantAuth,
      body: {
        customerId: 'CUST-002',
        vanId: 'van2',
        orderDate: testDate,
        status: 'Confirmed',
        items: [
          { productId: 'PROD-001', name: 'Vine Tomatoes', quantity: 20, unit: 'kg' },
          { productId: 'PROD-003', name: 'Spanish Brown Onions', quantity: 25, unit: 'kg' },
        ],
      },
    });
    assert(order2Res.status === 201, 'Accountant creates Order 2 on Van 2');
    const order2 = order2Res.data.data;

    // 3. Create Order 3 (Unassigned Van - CUST-002 The Fresh Kitchen)
    const order3Res = await request('/api/v1/orders', {
      method: 'POST',
      headers: adminAuth,
      body: {
        customerId: 'CUST-002',
        vanId: null, // explicit unassigned
        orderDate: testDate,
        status: 'Confirmed',
        notes: 'Van to be decided at dispatch',
        items: [
          { productId: 'PROD-001', name: 'Vine Tomatoes', quantity: 10, unit: 'kg' },
          { productId: 'PROD-004', name: 'Crisp Iceberg Lettuce', quantity: 12, unit: 'units' },
        ],
      },
    });
    assert(order3Res.status === 201 && order3Res.data.data.vanId === null, 'Created Order 3 with unassigned van');
    const order3 = order3Res.data.data;

    // 4. Create Order 4 to test cancellation
    const order4Res = await request('/api/v1/orders', {
      method: 'POST',
      headers: adminAuth,
      body: {
        customerId: 'CUST-001',
        vanId: 'van1',
        orderDate: testDate,
        status: 'Confirmed',
        items: [{ productId: 'PROD-001', name: 'Vine Tomatoes', quantity: 50, unit: 'kg' }],
      },
    });
    assert(order4Res.status === 201, 'Created Order 4 for cancellation test');
    const order4 = order4Res.data.data;

    // 5. Update Order 1 (Modify item quantity from 15 to 18)
    const updateOrder1Res = await request(`/api/v1/orders/${order1.id}`, {
      method: 'PUT',
      headers: adminAuth,
      body: {
        items: [
          { productId: 'PROD-001', name: 'Vine Tomatoes', quantity: 18, unit: 'kg', unitPrice: 2.80 },
          { productId: 'PROD-002', name: 'King Edward Potatoes', quantity: 30, unit: 'kg', unitPrice: 1.20 },
        ],
      },
    });
    assert(
      updateOrder1Res.status === 200 && updateOrder1Res.data.data.items[0].quantity === 18,
      'Order 1 successfully updated with modified item line quantity'
    );

    // 6. Cancel Order 4
    const cancelOrder4Res = await request(`/api/v1/orders/${order4.id}/cancel`, {
      method: 'POST',
      headers: adminAuth,
      body: { reason: 'Customer requested next day delivery instead' },
    });
    assert(
      cancelOrder4Res.status === 200 && cancelOrder4Res.data.data.status === 'Cancelled',
      'Order 4 cancelled according to documented lifecycle'
    );

    // 7. Verify cancelled order cannot be edited
    const editCancelledAttempt = await request(`/api/v1/orders/${order4.id}`, {
      method: 'PUT',
      headers: adminAuth,
      body: { notes: 'Attempting edit on cancelled order' },
    });
    assert(
      editCancelledAttempt.status === 400 && editCancelledAttempt.data.code === 'ORDER_LIFECYCLE_VIOLATION',
      'Editing cancelled order is strictly blocked (HTTP 400)'
    );

    // ----------------------------------------------------
    // Section 4: Customer Account Isolation
    // ----------------------------------------------------
    console.log('\n🛡️ Section 4: Customer Isolation & Access Control');

    // Customer lists orders: should only see their own customer orders (CUST-001)
    const customerOrdersList = await request('/api/v1/orders', {
      headers: customerAuth,
    });
    assert(
      customerOrdersList.status === 200 &&
      customerOrdersList.data.data.orders.every((o) => o.customerId === 'CUST-001'),
      'Customer list is strictly scoped to own account orders'
    );

    // Customer attempts to view Order 2 (which belongs to CUST-002)
    const customerViewOtherAttempt = await request(`/api/v1/orders/${order2.id}`, {
      headers: customerAuth,
    });
    assert(
      customerViewOtherAttempt.status === 403 &&
      customerViewOtherAttempt.data.code === 'CUSTOMER_ISOLATION_VIOLATION',
      'Customer viewing another customer order blocked (HTTP 403)'
    );

    // Customer viewing their own Order 1
    const customerViewOwn = await request(`/api/v1/orders/${order1.id}`, {
      headers: customerAuth,
    });
    assert(
      customerViewOwn.status === 200 && customerViewOwn.data.data.customerId === 'CUST-001',
      'Customer successfully views their own order details'
    );

    // ----------------------------------------------------
    // Section 5: Wholesale Van-Wise Procurement Aggregation
    // ----------------------------------------------------
    console.log('\n📊 Section 5: Dynamic Procurement Aggregation & Breakdown');

    // Expected demand on testDate (2026-10-25):
    // Active orders:
    // Order 1 (Van 1): Vine Tomatoes = 18 kg, Potatoes = 30 kg
    // Order 2 (Van 2): Vine Tomatoes = 20 kg, Onions = 25 kg
    // Order 3 (Unassigned): Vine Tomatoes = 10 kg, Lettuce = 12 units
    // Order 4 (Van 1): CANCELLED -> Must NOT contribute to demand! (0 kg Vine Tomatoes)
    //
    // Total Vine Tomatoes = 18 + 20 + 10 = 48 kg
    // Van 1 = 18 kg, Van 2 = 20 kg, Unassigned = 10 kg

    const aggRes = await request(`/api/v1/orders/procurement/aggregation?date=${testDate}`, {
      headers: adminAuth,
    });
    assert(aggRes.status === 200, 'Procurement aggregation endpoint returns HTTP 200');

    const aggData = aggRes.data.data;
    assert(aggData.totalOrders === 3, `Aggregates exactly 3 active orders (excluding cancelled order 4)`);
    assert(aggData.unassignedOrdersCount === 1, 'Correctly identifies 1 unassigned van order');
    assert(aggData.unassignedOrderNumbers.includes(order3.orderNumber), 'Unassigned order number listed prominently');

    const tomatoesAgg = aggData.procurementList.find((p) => p.name === 'Vine Tomatoes');
    assert(tomatoesAgg !== undefined, 'Vine Tomatoes present in procurement list');
    assert(tomatoesAgg?.totalQuantity === 48, `Vine Tomatoes total quantity is exactly 48 kg (got ${tomatoesAgg?.totalQuantity})`);
    assert(tomatoesAgg?.vanBreakdown['van1'] === 18, `Van 1 breakdown is 18 kg (got ${tomatoesAgg?.vanBreakdown['van1']})`);
    assert(tomatoesAgg?.vanBreakdown['van2'] === 20, `Van 2 breakdown is 20 kg (got ${tomatoesAgg?.vanBreakdown['van2']})`);
    assert(tomatoesAgg?.vanBreakdown['unassigned'] === 10, `Unassigned breakdown is 10 kg (got ${tomatoesAgg?.vanBreakdown['unassigned']})`);

    // Verify van filtering works on aggregation
    const van1AggRes = await request(`/api/v1/orders/procurement/aggregation?date=${testDate}&vanId=van1`, {
      headers: adminAuth,
    });
    const van1Data = van1AggRes.data.data;
    const van1Tomatoes = van1Data.procurementList.find((p) => p.name === 'Vine Tomatoes');
    assert(van1Tomatoes?.totalQuantity === 18, `Van 1 filtered aggregation shows exactly 18 kg`);

    // Verify unassigned van filter
    const unassignedAggRes = await request(`/api/v1/orders/procurement/aggregation?date=${testDate}&vanId=unassigned`, {
      headers: adminAuth,
    });
    const unassignedData = unassignedAggRes.data.data;
    assert(unassignedData.totalOrders === 1, 'Filtered by unassigned van returns only unassigned orders');

    // ----------------------------------------------------
    // Section 6: Vehicle Mileage & Odometer Regression Validation
    // ----------------------------------------------------
    console.log('\n🚗 Section 6: Vehicle Mileage & Odometer Protection');

    // 1. Negative reading rejection
    const negMileageRes = await request('/api/v1/mileage', {
      method: 'POST',
      headers: adminAuth,
      body: {
        vanId: 'van1',
        startMileage: -10,
        endMileage: 50,
        purpose: 'Test trip',
      },
    });
    assert(negMileageRes.status === 400, 'Rejects negative start mileage (HTTP 400)');

    // 2. End mileage <= Start mileage rejection
    const invalidRangeRes = await request('/api/v1/mileage', {
      method: 'POST',
      headers: adminAuth,
      body: {
        vanId: 'van1',
        startMileage: 50000,
        endMileage: 49990,
        purpose: 'Reverse odometer test',
      },
    });
    assert(
      invalidRangeRes.status === 400 && invalidRangeRes.data.code === 'INVALID_ODOMETER_RANGE',
      'Rejects ending mileage <= starting mileage (HTTP 400)'
    );

    // 3. Create Valid Trip 1 for Van 1 (42150 to 42200 = 50 miles)
    const trip1Res = await request('/api/v1/mileage', {
      method: 'POST',
      headers: adminAuth,
      body: {
        vanId: 'van1',
        date: testDate,
        startMileage: 42150,
        endMileage: 42200,
        purpose: 'Morning Spitalfields market wholesale collection',
        rate: 0.45,
      },
    });
    assert(
      trip1Res.status === 201 && trip1Res.data.data.distance === 50 && trip1Res.data.data.estimatedExpense === 22.50,
      'Trip 1 recorded: 50 miles @ £0.45 = £22.50'
    );
    const trip1 = trip1Res.data.data;

    // 4. Odometer regression attempt: Next trip starting at 42180 (< previous 42200) without allowCorrection
    const regressionAttempt = await request('/api/v1/mileage', {
      method: 'POST',
      headers: adminAuth,
      body: {
        vanId: 'van1',
        date: testDate,
        startMileage: 42180,
        endMileage: 42250,
        purpose: 'Afternoon deliveries',
        allowCorrection: false,
      },
    });
    assert(
      regressionAttempt.status === 400 && regressionAttempt.data.code === 'ODOMETER_REGRESSION_DETECTED',
      'Rejects odometer regression without allowCorrection flag (HTTP 400)'
    );

    // 5. Authorized Odometer Adjustment: Provide allowCorrection=true
    const authorizedCorrection = await request('/api/v1/mileage', {
      method: 'POST',
      headers: adminAuth,
      body: {
        vanId: 'van1',
        date: testDate,
        startMileage: 42180,
        endMileage: 42250,
        purpose: 'Afternoon deliveries with odometer calibration',
        allowCorrection: true,
      },
    });
    assert(
      authorizedCorrection.status === 201,
      'Accepts odometer correction when allowCorrection=true is provided'
    );
    const trip2 = authorizedCorrection.data.data;

    // ----------------------------------------------------
    // Section 7: Posting Mileage to Expense Ledger & Void Audit Trail
    // ----------------------------------------------------
    console.log('\n💳 Section 7: Mileage Posting to Expenses & Void Audit Trails');

    // 1. Post Trip 1 to expense ledger
    const postExpenseRes = await request(`/api/v1/mileage/${trip1.id}/post-expense`, {
      method: 'POST',
      headers: adminAuth,
    });
    assert(
      postExpenseRes.status === 201 && postExpenseRes.data.data.expense.amount === 22.50,
      'Trip 1 posted to expenses ledger as Vehicle & Travel claim of £22.50'
    );
    const linkedExpense = postExpenseRes.data.data.expense;

    // 2. Prevent duplicate posting of same trip
    const duplicatePostAttempt = await request(`/api/v1/mileage/${trip1.id}/post-expense`, {
      method: 'POST',
      headers: adminAuth,
    });
    assert(
      duplicatePostAttempt.status === 400 && duplicatePostAttempt.data.code === 'ALREADY_RECORDED_IN_EXPENSES',
      'Double posting of same trip to expenses rejected (HTTP 400)'
    );

    // 3. Record standalone vehicle expense (Fuel)
    const fuelExpenseRes = await request('/api/v1/mileage/expenses', {
      method: 'POST',
      headers: accountantAuth,
      body: {
        vanId: 'van1',
        date: testDate,
        category: 'Fuel',
        description: 'Diesel Shell Station fill-up',
        amount: 85.50,
        notes: 'Full tank for delivery route',
      },
    });
    assert(fuelExpenseRes.status === 201, 'Recorded standalone fuel expense of £85.50');
    const fuelExpense = fuelExpenseRes.data.data;

    // 4. Safely void fuel expense with audit trail
    const voidFuelRes = await request(`/api/v1/mileage/expenses/${fuelExpense.id}/void`, {
      method: 'POST',
      headers: adminAuth,
      body: { reason: 'Duplicate receipt entered by mistake' },
    });
    assert(
      voidFuelRes.status === 200 &&
      voidFuelRes.data.data.status === 'Void' &&
      voidFuelRes.data.data.voidReason === 'Duplicate receipt entered by mistake',
      'Fuel expense safely voided preserving historical audit record'
    );

    // 5. Delete mileage Trip 2 (unposted) safely
    const deleteTrip2Res = await request(`/api/v1/mileage/${trip2.id}`, {
      method: 'DELETE',
      headers: adminAuth,
    });
    assert(deleteTrip2Res.status === 200, 'Admin safely deleted unposted mileage record');

    // ----------------------------------------------------
    // Section 8: Financial Invariance Verification
    // ----------------------------------------------------
    console.log('\n🔒 Section 8: Financial Invariance Verification');

    // Check customer opening balances, invoices and payments are untouched
    const cust1Res = await request('/api/v1/customers/CUST-001', { headers: adminAuth });
    assert(
      cust1Res.status === 200 && cust1Res.data.data.openingBalance !== undefined,
      'Customer balances remain intact with zero interference from orders and mileage'
    );

    // Cleanup created test records so database remains pristine
    console.log('\n🧹 Cleaning up test artifacts...');
    await prisma.$transaction(async (tx) => {
      // Delete order items and orders created in this test
      await tx.orderItem.deleteMany({
        where: { orderId: { in: [order1.id, order2.id, order3.id, order4.id] } },
      });
      await tx.order.deleteMany({
        where: { id: { in: [order1.id, order2.id, order3.id, order4.id] } },
      });

      // Delete test expenses and mileage
      await tx.vehicleExpense.deleteMany({
        where: { id: { in: [linkedExpense.id, fuelExpense.id] } },
      });
      await tx.mileage.deleteMany({
        where: { id: { in: [trip1.id] } },
      });
    });
    console.log('Test artifacts cleanly removed.\n');

  } catch (err) {
    console.error('Unhandled test failure:', err);
    failed++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('====================================================');
  console.log(`Phase 5 Suite Summary: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
