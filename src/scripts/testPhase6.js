/**
 * LedgerFlow — Phase 6 Customer, Product & Van Integration Verification Suite
 * Tests live endpoints, authentication cookie session, role permissions, and safe deletion.
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';

let adminCookie = '';
let accountantCookie = '';
let customerCookie = '';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (options.cookie) {
    headers['Cookie'] = options.cookie;
  }

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const setCookie = res.headers.get('set-cookie');
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // Non-JSON response
  }

  return {
    status: res.status,
    headers: res.headers,
    setCookie,
    data,
  };
}

async function runPhase6Tests() {
  console.log('====================================================');
  console.log('🧪 Starting LedgerFlow Phase 6 Verification Suite');
  console.log('====================================================\n');

  // Step 1: Health Check
  console.log('📋 Test Group 1: Server Health & Live Connectivity');
  const healthRes = await request('/api/health');
  assert(healthRes.status === 200 && healthRes.data?.status === 'ok', 'GET /api/health returns 200 OK');

  const dbHealthRes = await request('/api/db-health');
  assert(dbHealthRes.status === 200 && dbHealthRes.data?.database === 'connected', 'GET /api/db-health returns 200 OK with connected MySQL');

  // Step 2: Authentication
  console.log('\n📋 Test Group 2: Authenticated Cookie Session Establishment');
  const adminLogin = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'admin@freshharvest.co.uk', password: 'Password123!' },
  });
  assert(adminLogin.status === 200 && adminLogin.data?.user?.role === 'admin', 'Admin logged in successfully');
  adminCookie = adminLogin.setCookie?.split(';')[0] || '';

  const accountantLogin = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'accounts@freshharvest.co.uk', password: 'Password123!' },
  });
  assert(accountantLogin.status === 200 && accountantLogin.data?.user?.role === 'accountant', 'Accountant logged in successfully');
  accountantCookie = accountantLogin.setCookie?.split(';')[0] || '';

  const customerLogin = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'accounts@greenvalley.co.uk', password: 'Password123!' },
  });
  assert(customerLogin.status === 200 && customerLogin.data?.user?.role === 'customer', 'Customer logged in successfully');
  customerCookie = customerLogin.setCookie?.split(';')[0] || '';

  // Step 3: Customer Endpoints & Role Permissions
  console.log('\n📋 Test Group 3: Customer Management & RBAC Permissions');
  const adminCustList = await request('/api/v1/customers', { cookie: adminCookie });
  assert(adminCustList.status === 200 && Array.isArray(adminCustList.data?.data), 'Admin can list customers directory');
  assert(adminCustList.data?.data?.length > 0, `Live customers loaded from DB (${adminCustList.data?.data?.length} customers found)`);

  const acctCustList = await request('/api/v1/customers', { cookie: accountantCookie });
  assert(acctCustList.status === 200, 'Accountant can list customers directory');

  const custRoleList = await request('/api/v1/customers', { cookie: customerCookie });
  assert(custRoleList.status === 403, 'Customer role is FORBIDDEN (403) from listing all customers directory');

  const custOwnProfile = await request('/api/v1/customers/CUST-001', { cookie: customerCookie });
  assert(custOwnProfile.status === 200 && custOwnProfile.data?.data?.id === 'CUST-001', 'Customer can view own profile (CUST-001)');

  const custCompetitorProfile = await request('/api/v1/customers/CUST-002', { cookie: customerCookie });
  assert(custCompetitorProfile.status === 403, 'Customer isolation: Blocked from viewing other customer (CUST-002) with 403 Forbidden');

  const custStatement = await request('/api/v1/customers/CUST-001/statement', { cookie: customerCookie });
  assert(custStatement.status === 200 && custStatement.data?.data?.summary, 'Customer can view own financial statement');

  // Create test customer
  const tempCustId = `CUST-TEST-${Date.now().toString().slice(-4)}`;
  const createCustRes = await request('/api/v1/customers', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      id: tempCustId,
      name: 'Integration Test Bistro',
      contactPerson: 'Chef Laurent',
      email: `${tempCustId.toLowerCase()}@example.com`,
      phone: '+44 20 7946 0999',
      address: '77 Test Way, London',
      paymentTerms: 14,
      vanId: 'van1',
      openingBalance: 250.00,
    },
  });
  assert(createCustRes.status === 201 && createCustRes.data?.data?.id === tempCustId, `Admin created customer '${tempCustId}' with van1 assignment`);

  const customerCreateForbidden = await request('/api/v1/customers', {
    method: 'POST',
    cookie: customerCookie,
    body: { name: 'Hack Bistro' },
  });
  assert(customerCreateForbidden.status === 403, 'Customer role is FORBIDDEN (403) from creating customers');

  // Update test customer
  const updateCustRes = await request(`/api/v1/customers/${tempCustId}`, {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      name: 'Integration Test Bistro (Updated)',
      openingBalance: 300.00,
    },
  });
  assert(
    updateCustRes.status === 200 && parseFloat(updateCustRes.data?.data?.openingBalance) === 300,
    'Admin updated customer name and opening balance'
  );

  // Soft deactivate test customer
  const softDelCustRes = await request(`/api/v1/customers/${tempCustId}`, {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert(softDelCustRes.status === 200, 'Admin safely soft-deactivated customer');

  // Hard delete test customer
  const hardDelCustRes = await request(`/api/v1/customers/${tempCustId}?hard=true`, {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert(hardDelCustRes.status === 200, 'Admin permanently hard-deleted unlinked test customer');

  // Deletion safety policy on CUST-001
  const safetyHardDel = await request('/api/v1/customers/CUST-001?hard=true', {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert(safetyHardDel.status === 409, 'Safety policy: Cannot hard delete customer with linked users/invoices (409 Conflict)');

  // Step 4: Product Endpoints
  console.log('\n📋 Test Group 4: Product Catalog Management');
  const prodList = await request('/api/v1/products', { cookie: adminCookie });
  assert(prodList.status === 200 && Array.isArray(prodList.data?.data), 'Admin can list product catalog');
  assert(prodList.data?.data?.length >= 12, `Seeded wholesale products loaded from DB (${prodList.data?.data?.length} items)`);

  const custProdList = await request('/api/v1/products', { cookie: customerCookie });
  assert(custProdList.status === 200, 'Customer role can view wholesale product catalog');

  const singleProd = await request('/api/v1/products/PROD-001', { cookie: adminCookie });
  assert(singleProd.status === 200 && singleProd.data?.data?.id === 'PROD-001', 'Can retrieve single product details (PROD-001)');

  const tempProdId = `PROD-TEST-${Date.now().toString().slice(-4)}`;
  const createProdRes = await request('/api/v1/products', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      id: tempProdId,
      name: 'Test Organic Honey',
      unit: 'jar',
      defaultRate: 4.50,
      defaultVat: 0,
      category: 'Pantry',
      stock: 50,
    },
  });
  assert(createProdRes.status === 201 && createProdRes.data?.data?.id === tempProdId, `Admin created product '${tempProdId}'`);

  const custCreateProd = await request('/api/v1/products', {
    method: 'POST',
    cookie: customerCookie,
    body: { name: 'Illegal Item', unit: 'kg' },
  });
  assert(custCreateProd.status === 403, 'Customer role is FORBIDDEN (403) from creating products');

  const updateProdRes = await request(`/api/v1/products/${tempProdId}`, {
    method: 'PUT',
    cookie: adminCookie,
    body: { defaultRate: 5.00 },
  });
  assert(
    updateProdRes.status === 200 && parseFloat(updateProdRes.data?.data?.defaultRate) === 5,
    'Admin updated product price'
  );

  const hardDelProd = await request(`/api/v1/products/${tempProdId}?hard=true`, {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert(hardDelProd.status === 200, 'Admin permanently hard-deleted test product');

  // Step 5: Delivery Van Endpoints
  console.log('\n📋 Test Group 5: Delivery Van Management');
  const vanList = await request('/api/v1/vans', { cookie: adminCookie });
  assert(vanList.status === 200 && Array.isArray(vanList.data?.data), 'Admin listed delivery vans');
  assert(vanList.data?.data?.length >= 3, `Live delivery routes loaded from DB (${vanList.data?.data?.length} vans found)`);

  const custVanList = await request('/api/v1/vans', { cookie: customerCookie });
  assert(custVanList.status === 200, 'Customer role can view delivery routes');

  const singleVan = await request('/api/v1/vans/van1', { cookie: adminCookie });
  assert(singleVan.status === 200 && singleVan.data?.data?.id === 'van1', 'Can retrieve single van details (van1)');

  const tempVanId = `van_test_${Date.now().toString().slice(-4)}`;
  const createVanRes = await request('/api/v1/vans', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      id: tempVanId,
      name: 'South London Logistics',
      vehicle: 'Mercedes Sprinter (RE24 QRS)',
    },
  });
  assert(createVanRes.status === 201 && createVanRes.data?.data?.id === tempVanId, `Admin created van '${tempVanId}'`);

  const custCreateVan = await request('/api/v1/vans', {
    method: 'POST',
    cookie: customerCookie,
    body: { id: 'van_bad', name: 'Illegal Van' },
  });
  assert(custCreateVan.status === 403, 'Customer role is FORBIDDEN (403) from creating vans');

  const delActiveVan = await request('/api/v1/vans/van1', {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert(delActiveVan.status === 409, 'Safety check: Cannot delete van assigned to active customers (409 Conflict)');

  const delTempVan = await request(`/api/v1/vans/${tempVanId}`, {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert(delTempVan.status === 200, 'Admin deleted unassigned test van');

  console.log('\n====================================================');
  console.log(`📊 Phase 6 Verification Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase6Tests().catch((err) => {
  console.error('Fatal error running Phase 6 tests:', err);
  process.exit(1);
});
