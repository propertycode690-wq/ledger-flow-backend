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
  console.log('🧪 Starting LedgerFlow Phase 3 Verification Suite');
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
    // Step 0: Obtain Auth Tokens for all 3 Roles
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

    assert(adminToken && accountantToken && customerToken, 'Successfully logged in as admin, accountant, and customer');

    // ----------------------------------------------------
    // Test Group 1: Delivery Vans APIs
    // ----------------------------------------------------
    console.log('\n📋 Test Group 1: Van Route Management APIs');
    const listVansRes = await request('/api/v1/vans', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(listVansRes.status === 200 && Array.isArray(listVansRes.data?.data), 'GET /api/v1/vans returns list of vans');
    assert(listVansRes.data?.data?.some((v) => v.id === 'van1' && v.customerCount > 0), 'Vans include assigned customer counts');

    // Customer and accountant can also view vans
    const custVansRes = await request('/api/v1/vans', {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(custVansRes.status === 200, 'Customer role can read vans list for order routing');

    // Create a new van
    const testVanId = `van_test_${Date.now()}`;
    const createVanRes = await request('/api/v1/vans', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { id: testVanId, name: 'Test Route Van', vehicle: 'Mercedes Vito - TE57 VTO' },
    });
    assert(createVanRes.status === 201 && createVanRes.data?.data?.id === testVanId, 'Admin can create a new delivery van (201 Created)');

    // Non-admin cannot create van
    const custCreateVan = await request('/api/v1/vans', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerToken}` },
      body: { id: 'van_cust_fail', name: 'Illegal Van' },
    });
    assert(custCreateVan.status === 403, 'Customer cannot create delivery van (403 Forbidden)');

    // Duplicate van ID
    const dupVan = await request('/api/v1/vans', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { id: testVanId, name: 'Duplicate Van' },
    });
    assert(dupVan.status === 409 && dupVan.data?.code === 'DUPLICATE_VAN_ID', 'Rejects duplicate van ID with 409 DUPLICATE_VAN_ID');

    // Update van
    const updateVanRes = await request(`/api/v1/vans/${testVanId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { vehicle: 'Updated Sprinter - UP72 XRT' },
    });
    assert(updateVanRes.status === 200 && updateVanRes.data?.data?.vehicle === 'Updated Sprinter - UP72 XRT', 'Admin can update van details (200 OK)');

    // Safe deletion: Attempt to delete van with assigned customers (van1 has CUST-001)
    const deleteAssignedVan = await request('/api/v1/vans/van1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      deleteAssignedVan.status === 409 && deleteAssignedVan.data?.code === 'VAN_HAS_ASSIGNED_CUSTOMERS',
      'Safety check: Cannot delete van assigned to active customers (409 Conflict)'
    );

    // Delete unassigned test van
    const deleteTestVan = await request(`/api/v1/vans/${testVanId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(deleteTestVan.status === 200, 'Unassigned van safely deleted with 200 OK');

    // ----------------------------------------------------
    // Test Group 2: Product Catalog APIs
    // ----------------------------------------------------
    console.log('\n📋 Test Group 2: Product Catalog Management APIs');
    const listProductsRes = await request('/api/v1/products', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      listProductsRes.status === 200 && listProductsRes.data?.data?.length >= 12,
      'GET /api/v1/products returns catalog with pagination metadata'
    );

    // Search filter
    const searchProdRes = await request('/api/v1/products?search=Tomatoes', {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(
      searchProdRes.status === 200 && searchProdRes.data?.data?.every((p) => p.name.includes('Tomatoes')),
      'Product search filters by name correctly'
    );

    // Category filter
    const categoryProdRes = await request('/api/v1/products?category=Pantry', {
      headers: { Authorization: `Bearer ${accountantToken}` },
    });
    assert(
      categoryProdRes.status === 200 && categoryProdRes.data?.data?.every((p) => p.category === 'Pantry'),
      'Product category filter works correctly'
    );

    // Get single product
    const getProdRes = await request('/api/v1/products/PROD-001', {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(getProdRes.status === 200 && getProdRes.data?.data?.name === 'Vine Tomatoes', 'GET /api/v1/products/:id returns single product');

    // Missing product 404
    const getNonExistentProd = await request('/api/v1/products/PROD-NONEXISTENT', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(getNonExistentProd.status === 404 && getNonExistentProd.data?.code === 'PRODUCT_NOT_FOUND', 'Returns 404 PRODUCT_NOT_FOUND for unknown product');

    // Create product
    const testProdId = `PROD-TEST-${Date.now().toString().slice(-4)}`;
    const createProdRes = await request('/api/v1/products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        id: testProdId,
        name: 'Organic Baby Spinach',
        unit: 'kg',
        defaultRate: 4.50,
        defaultVat: 0,
        category: 'Salads',
        stock: 50,
      },
    });
    assert(createProdRes.status === 201 && createProdRes.data?.data?.id === testProdId, 'Admin creates new product (201 Created)');

    // Customer cannot create product
    const custCreateProd = await request('/api/v1/products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerToken}` },
      body: { name: 'Illegal Herb', unit: 'bunches' },
    });
    assert(custCreateProd.status === 403, 'Customer cannot create product (403 Forbidden)');

    // Invalid product rates (negative rate)
    const invalidProd = await request('/api/v1/products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'Invalid Rate Product', unit: 'kg', defaultRate: -10 },
    });
    assert(invalidProd.status === 400 && invalidProd.data?.code === 'VALIDATION_ERROR', 'Rejects negative default rate with 400 VALIDATION_ERROR');

    // Update product
    const updateProdRes = await request(`/api/v1/products/${testProdId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { defaultRate: 4.80, stock: 75 },
    });
    assert(updateProdRes.status === 200 && updateProdRes.data?.data?.defaultRate == 4.80, 'Admin updates product pricing and stock (200 OK)');

    // Safe deletion: Soft-deactivates product
    const softDeleteProd = await request(`/api/v1/products/${testProdId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(softDeleteProd.status === 200 && softDeleteProd.data?.data?.isActive === false, 'Product deletion soft-deactivates product (isActive: false)');

    // Hard delete test product
    const hardDeleteProd = await request(`/api/v1/products/${testProdId}?hard=true`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(hardDeleteProd.status === 200, 'Hard delete permanently removes product');

    // ----------------------------------------------------
    // Test Group 3: Customer Directory & Detail APIs
    // ----------------------------------------------------
    console.log('\n📋 Test Group 3: Customer Management & RBAC APIs');
    // Admin & Accountant list customers
    const listCustAdmin = await request('/api/v1/customers', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(listCustAdmin.status === 200 && listCustAdmin.data?.data?.length >= 2, 'Admin can list customers directory with pagination and van routing');

    const listCustAcc = await request('/api/v1/customers', {
      headers: { Authorization: `Bearer ${accountantToken}` },
    });
    assert(listCustAcc.status === 200, 'Accountant can list customers directory');

    // Customer role is FORBIDDEN from browsing the customer list
    const listCustClient = await request('/api/v1/customers', {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(listCustClient.status === 403, 'Customer role is FORBIDDEN (403) from listing all customer directory');

    // Customer accessing their own profile:
    const getCustSelf = await request('/api/v1/customers/CUST-001', {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(
      getCustSelf.status === 200 && getCustSelf.data?.data?.id === 'CUST-001' && getCustSelf.data?.data?.van?.id === 'van1',
      'Customer successfully retrieves own profile including delivery van route (200 OK)'
    );

    // Customer accessing another customer's profile:
    const getCustOther = await request('/api/v1/customers/CUST-002', {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(
      getCustOther.status === 403 && getCustOther.data?.code === 'CUSTOMER_ISOLATION_VIOLATION',
      'Customer isolation: Blocked from viewing CUST-002 with 403 CUSTOMER_ISOLATION_VIOLATION'
    );

    // Admin can access any customer profile:
    const getCustByAdmin = await request('/api/v1/customers/CUST-002', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(getCustByAdmin.status === 200 && getCustByAdmin.data?.data?.id === 'CUST-002', 'Admin can access any customer profile (200 OK)');

    // ----------------------------------------------------
    // Test Group 4: Customer Creation, Validation & Safe Deletion
    // ----------------------------------------------------
    console.log('\n📋 Test Group 4: Customer Creation, Opening Balances & Safe Deletion');
    // Reject invalid vanId
    const invalidVanCust = await request('/api/v1/customers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'Bad Van Cafe', vanId: 'van_nonexistent_999' },
    });
    assert(invalidVanCust.status === 400 && invalidVanCust.data?.code === 'INVALID_VAN_ID', 'Rejects customer creation with non-existent vanId (400 INVALID_VAN_ID)');

    // Reject negative opening balance
    const negBalCust = await request('/api/v1/customers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'Negative Bal Cafe', openingBalance: -500 },
    });
    assert(negBalCust.status === 400 && negBalCust.data?.code === 'VALIDATION_ERROR', 'Rejects negative opening balance (400 VALIDATION_ERROR)');

    // Create customer with opening balance and van assignment
    const testCustId = `CUST-TEST-${Date.now().toString().slice(-4)}`;
    const createCustRes = await request('/api/v1/customers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        id: testCustId,
        name: 'The Organic Baker & Cafe',
        contactPerson: 'Sophie Turner',
        email: 'sophie@organicbaker.co.uk',
        phone: '+44 20 7946 0991',
        address: '12 Camden High Street, London, NW1 0JH',
        paymentTerms: 14,
        status: 'Active',
        openingBalance: 450.00,
        vanId: 'van2',
        notes: 'Deliver before 7:00 AM.',
      },
    });
    assert(
      createCustRes.status === 201 && createCustRes.data?.data?.id === testCustId && createCustRes.data?.data?.openingBalance == 450.00,
      'Admin creates customer with opening balance £450.00 and van2 assignment (201 Created)'
    );

    // Update customer opening balance and details
    const updateCustRes = await request(`/api/v1/customers/${testCustId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { openingBalance: 500.00, phone: '+44 20 7946 0999' },
    });
    assert(updateCustRes.status === 200 && updateCustRes.data?.data?.openingBalance == 500.00, 'Admin updates customer opening balance to £500.00 (200 OK)');

    // Safe Deletion: Attempt to permanently hard-delete customer with linked users (CUST-001 has USR-CUST-001)
    const deleteLinkedCust = await request('/api/v1/customers/CUST-001?hard=true', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      deleteLinkedCust.status === 409 && deleteLinkedCust.data?.code === 'CUSTOMER_HAS_LINKED_USERS',
      'Safety policy: Cannot permanently delete customer with linked user login accounts (409 Conflict)'
    );

    // Default Safe Deletion on test customer: Soft deactivates (status = Inactive)
    const softDeleteCust = await request(`/api/v1/customers/${testCustId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(
      softDeleteCust.status === 200 && softDeleteCust.data?.data?.status === 'Inactive',
      'Default customer deletion soft-deactivates account (Status: Inactive)'
    );

    // Hard delete test customer (unlinked)
    const hardDeleteCust = await request(`/api/v1/customers/${testCustId}?hard=true`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(hardDeleteCust.status === 200, 'Unlinked customer permanently deleted with hard=true');

    // ----------------------------------------------------
    // Test Group 5: Phase 1 & 2 Regressions
    // ----------------------------------------------------
    console.log('\n📋 Test Group 5: Phase 1 & Phase 2 Regression Checks');
    const health = await request('/api/health');
    assert(health.status === 200, 'Regression: /api/health returns 200 OK');

    const dbHealth = await request('/api/db-health');
    assert(dbHealth.status === 200 && dbHealth.data?.database === 'connected', 'Regression: /api/db-health returns 200 connected');

    const authMe = await request('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(authMe.status === 200 && authMe.data?.user?.email === 'admin@freshharvest.co.uk', 'Regression: /api/v1/auth/me returns 200 with user profile');

    const logoutRes = await request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(logoutRes.status === 200, 'Regression: /api/v1/auth/logout returns 200 OK');

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
  console.log(`📊 Phase 3 Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
