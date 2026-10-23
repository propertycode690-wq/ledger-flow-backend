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
  const setCookie = res.headers.get('set-cookie');
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { status, data, setCookie };
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting LedgerFlow Phase 2 Verification Suite');
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

  // Start test server on random available port
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  console.log(`Test server listening on ${baseUrl}\n`);

  try {
    // ----------------------------------------------------
    // Test 1: Phase 1 Health endpoints still operational
    // ----------------------------------------------------
    console.log('📋 Test Group 1: Phase 1 Health Endpoints');
    const health = await request('/api/health');
    assert(health.status === 200 && health.data?.status === 'ok', 'GET /api/health returns 200 OK');

    const dbHealth = await request('/api/db-health');
    assert(
      dbHealth.status === 200 && dbHealth.data?.database === 'connected' && dbHealth.data?.details?.database_name === 'ledgerflow_db',
      'GET /api/db-health returns 200 OK with connected ledgerflow_db'
    );

    // ----------------------------------------------------
    // Test 2: Validation on Login Request Body
    // ----------------------------------------------------
    console.log('\n📋 Test Group 2: Login Input Validation');
    const invalidEmail = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'notanemail', password: 'password123' },
    });
    assert(invalidEmail.status === 400 && invalidEmail.data?.code === 'VALIDATION_ERROR', 'Rejects malformed email with 400 VALIDATION_ERROR');

    const missingPass = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'admin@freshharvest.co.uk', password: '' },
    });
    assert(missingPass.status === 400 && missingPass.data?.code === 'VALIDATION_ERROR', 'Rejects empty password with 400 VALIDATION_ERROR');

    // ----------------------------------------------------
    // Test 3: Invalid Credentials (Email and Password)
    // ----------------------------------------------------
    console.log('\n📋 Test Group 3: Invalid Credentials Protection');
    const wrongPass = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'admin@freshharvest.co.uk', password: 'WrongPassword999!' },
    });
    assert(wrongPass.status === 401 && wrongPass.data?.code === 'INVALID_CREDENTIALS', 'Rejects wrong password with 401 INVALID_CREDENTIALS');

    const unknownUser = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'nonexistent@nowhere.com', password: 'Password123!' },
    });
    assert(unknownUser.status === 401 && unknownUser.data?.code === 'INVALID_CREDENTIALS', 'Rejects non-existent email with generic 401 (no enumeration)');

    // ----------------------------------------------------
    // Test 4: Successful Admin Login & Password Hash Protection
    // ----------------------------------------------------
    console.log('\n📋 Test Group 4: Admin Authentication & Profile Sanitization');
    const adminLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'admin@freshharvest.co.uk', password: 'Password123!' },
    });
    assert(adminLogin.status === 200 && adminLogin.data?.user?.role === 'admin', 'Admin logs in successfully with 200 OK');
    assert(adminLogin.data?.user?.passwordHash === undefined, 'Admin response never exposes passwordHash');
    assert(adminLogin.setCookie && adminLogin.setCookie.includes('token='), 'Sets HTTP-Only token cookie');
    const adminToken = adminLogin.data?.token;

    // ----------------------------------------------------
    // Test 5: Protected Current User Profile (/me)
    // ----------------------------------------------------
    console.log('\n📋 Test Group 5: Current User Session (/api/v1/auth/me)');
    const unauthMe = await request('/api/v1/auth/me');
    assert(unauthMe.status === 401 && unauthMe.data?.code === 'UNAUTHORIZED', 'Rejects unauthenticated /me with 401');

    const authMe = await request('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(authMe.status === 200 && authMe.data?.user?.email === 'admin@freshharvest.co.uk', 'Valid token returns current user profile with 200 OK');
    assert(authMe.data?.user?.passwordHash === undefined, '/me response strictly omits passwordHash');

    // ----------------------------------------------------
    // Test 6: Accountant Authentication & RBAC
    // ----------------------------------------------------
    console.log('\n📋 Test Group 6: Accountant Role & RBAC Boundaries');
    const accountantLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'accounts@freshharvest.co.uk', password: 'Password123!' },
    });
    assert(accountantLogin.status === 200 && accountantLogin.data?.user?.role === 'accountant', 'Accountant logs in successfully with 200 OK');
    const accountantToken = accountantLogin.data?.token;

    const accountantOnAdminRoute = await request('/api/v1/auth/admin-only', {
      headers: { Authorization: `Bearer ${accountantToken}` },
    });
    assert(accountantOnAdminRoute.status === 403 && accountantOnAdminRoute.data?.code === 'FORBIDDEN', 'Accountant is FORBIDDEN (403) from accessing admin-only endpoint');

    const accountantOnAccountantRoute = await request('/api/v1/auth/accountant-only', {
      headers: { Authorization: `Bearer ${accountantToken}` },
    });
    assert(accountantOnAccountantRoute.status === 200, 'Accountant successfully accesses accountant-only endpoint with 200 OK');

    const adminOnAccountantRoute = await request('/api/v1/auth/accountant-only', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminOnAccountantRoute.status === 200, 'Admin can also access accountant endpoint (executive privileges)');

    // ----------------------------------------------------
    // Test 7: Customer Authentication & Strict Isolation
    // ----------------------------------------------------
    console.log('\n📋 Test Group 7: Customer Portal & Account Isolation');
    const customerLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'accounts@greenvalley.co.uk', password: 'Password123!' },
    });
    assert(
      customerLogin.status === 200 && customerLogin.data?.user?.role === 'customer' && customerLogin.data?.user?.customerId === 'CUST-001',
      'Customer logs in and is strictly associated with CUST-001'
    );
    const customerToken = customerLogin.data?.token;

    const customerOnAccountantRoute = await request('/api/v1/auth/accountant-only', {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(customerOnAccountantRoute.status === 403, 'Customer cannot access accountant ledger routes (403 Forbidden)');

    // Customer accessing their own account:
    const customerSelfData = await request('/api/v1/auth/customer-data/CUST-001', {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(customerSelfData.status === 200, 'Customer successfully accesses own account data (CUST-001)');

    // Customer attempting to access ANOTHER customer account:
    const customerCompetitorData = await request('/api/v1/auth/customer-data/CUST-002', {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert(
      customerCompetitorData.status === 403 && customerCompetitorData.data?.code === 'CUSTOMER_ISOLATION_VIOLATION',
      'Server BLOCKS customer from accessing competitor account (CUST-002) with 403 CUSTOMER_ISOLATION_VIOLATION'
    );

    // Admin accessing customer CUST-002:
    const adminCustomerData = await request('/api/v1/auth/customer-data/CUST-002', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminCustomerData.status === 200, 'Admin can access any customer account for management (200 OK)');

    // ----------------------------------------------------
    // Test 8: Logout and Session Invalidation
    // ----------------------------------------------------
    console.log('\n📋 Test Group 8: Logout');
    const logoutRes = await request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(logoutRes.status === 200 && logoutRes.data?.status === 'ok', 'Logout endpoint returns 200 OK');
    assert(logoutRes.setCookie && (logoutRes.setCookie.includes('Max-Age=0') || logoutRes.setCookie.includes('token=;')), 'Clears authentication cookie');

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
  console.log(`📊 Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
