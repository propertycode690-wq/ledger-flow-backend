/**
 * Automated Verification Suite for User Permissions & Access Control
 * Target Environment: Disposable Staging Database (ledgerflow_staging_test)
 */

import http from 'http';
import dotenv from 'dotenv';

// Override DATABASE_URL to strictly target the disposable staging database
const envConfig = dotenv.config().parsed || {};
const originalDbUrl = process.env.DATABASE_URL || envConfig.DATABASE_URL;
const stagingDbUrl = originalDbUrl.replace(/\/ledgerflow_db(\?|$)/, '/ledgerflow_staging_test$1');
process.env.DATABASE_URL = stagingDbUrl;

// Import app and Prisma client after setting staging DATABASE_URL
const { default: app } = await import('../app.js');
const { default: prisma } = await import('../config/db.js');

let server;
let baseUrl;

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = options.headers || {};
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
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

  return { status, data, headers: res.headers };
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 Starting LedgerFlow User Permissions Staging Verification Suite');
  console.log(`🎯 Target Database: ${stagingDbUrl.replace(/:[^:]*@/, ':****@')}`);
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, detail = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  // Bind to random ephemeral port
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Staging test server listening on ${baseUrl}\n`);

  try {
    // ----------------------------------------------------
    // Section 1: Authentication & Baseline Token Generation
    // ----------------------------------------------------
    console.log('📋 Test Group 1: Admin & Baseline Authentication');

    const adminLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'admin@freshharvest.co.uk', password: 'Password123!' },
    });
    // Fallback if password was 123456
    let adminToken = adminLogin.data?.token;
    if (!adminToken) {
      const retryAdmin = await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: 'admin@freshharvest.co.uk', password: '123456' },
      });
      adminToken = retryAdmin.data?.token;
    }
    assert(!!adminToken, 'Admin can log in and receive JWT token');

    const accountantLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'accounts@freshharvest.co.uk', password: 'Password123!' },
    });
    let accountantToken = accountantLogin.data?.token;
    if (!accountantToken) {
      const retryAcc = await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: 'accounts@freshharvest.co.uk', password: '123456' },
      });
      accountantToken = retryAcc.data?.token;
    }
    assert(!!accountantToken, 'Accountant can log in and receive JWT token');

    // Verify existing accountant received default reports-only permissions
    const meAcc = await request('/api/v1/auth/me', { token: accountantToken });
    const accPerms = meAcc.data?.user?.effectivePermissions || [];
    assert(
      accPerms.includes('reports:view') &&
      accPerms.includes('reports:vat') &&
      accPerms.includes('reports:pnl') &&
      !accPerms.includes('invoices:create') &&
      !accPerms.includes('users:manage'),
      'Existing Accountant account safely defaults to reports-only permissions',
      `Effective: ${JSON.stringify(accPerms)}`
    );

    // ----------------------------------------------------
    // Section 2: Admin User Management Operations
    // ----------------------------------------------------
    console.log('\n📋 Test Group 2: Admin User Management');

    // 1. List users
    const listRes = await request('/api/v1/users', { token: adminToken });
    assert(listRes.status === 200 && Array.isArray(listRes.data?.data), 'Admin can list all system users');

    // 2. Create a new user with granular permissions
    const newAccountantEmail = `test.accountant.${Date.now()}@freshharvest.co.uk`;
    const createRes = await request('/api/v1/users', {
      method: 'POST',
      token: adminToken,
      body: {
        name: 'Staging Auditor',
        email: newAccountantEmail,
        password: 'Password123!',
        role: 'accountant',
        title: 'Junior Auditor',
        permissions: ['reports:view', 'reports:pnl'],
      },
    });
    assert(createRes.status === 201 && createRes.data?.data?.email === newAccountantEmail, 'Admin can create a new user account with assigned permissions');
    const createdUserId = createRes.data?.data?.id;

    // 3. Edit user permissions
    const updatePermsRes = await request(`/api/v1/users/${createdUserId}`, {
      method: 'PUT',
      token: adminToken,
      body: {
        permissions: ['reports:view', 'reports:pnl', 'reports:vat'],
      },
    });
    assert(
      updatePermsRes.status === 200 &&
      updatePermsRes.data?.data?.effectivePermissions?.includes('reports:vat'),
      'Admin can update user permissions and changes take effect'
    );

    // 4. Deactivate and reactivate user safely
    const deactivateRes = await request(`/api/v1/users/${createdUserId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { isActive: false },
    });
    assert(deactivateRes.status === 200 && deactivateRes.data?.data?.isActive === false, 'Admin can safely deactivate user account');

    // Deactivated user cannot log in
    const deactivatedLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: newAccountantEmail, password: 'Password123!' },
    });
    assert(deactivatedLogin.status === 403 && deactivatedLogin.data?.code === 'ACCOUNT_DEACTIVATED', 'Deactivated user cannot log in (403 ACCOUNT_DEACTIVATED)');

    // Reactivate user
    const reactivateRes = await request(`/api/v1/users/${createdUserId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { isActive: true },
    });
    assert(reactivateRes.status === 200 && reactivateRes.data?.data?.isActive === true, 'Admin can safely reactivate user account');

    // Self-deactivation protection
    const selfDeactivateRes = await request(`/api/v1/users/${adminLogin.data?.user?.id || 'USR-ADMIN'}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { isActive: false },
    });
    assert(selfDeactivateRes.status === 400 && selfDeactivateRes.data?.code === 'CANNOT_DEACTIVATE_SELF', 'Admin is prevented from deactivating their own account (prevents lockout)');

    // ----------------------------------------------------
    // Section 3: Accountant Authorized Access to Reports
    // ----------------------------------------------------
    console.log('\n📋 Test Group 3: Accountant Reports Access (Authorized)');

    const vatReportRes = await request('/api/v1/reports/vat-return', { token: accountantToken });
    assert(vatReportRes.status === 200, 'Accountant can view authorized VAT Return report (200 OK)');

    const pnlReportRes = await request('/api/v1/reports/pnl', { token: accountantToken });
    assert(pnlReportRes.status === 200, 'Accountant can view authorized Profit & Loss report (200 OK)');

    const agedDebtorsRes = await request('/api/v1/reports/aged-debtors', { token: accountantToken });
    assert(agedDebtorsRes.status === 200, 'Accountant can view authorized Aged Debtors report (200 OK)');

    // ----------------------------------------------------
    // Section 4: Accountant Restricted Operations (Invoices)
    // ----------------------------------------------------
    console.log('\n📋 Test Group 4: Accountant Invoice Restrictions (Enforced)');

    // 1. Cannot create invoice
    const createInvRes = await request('/api/v1/invoices', {
      method: 'POST',
      token: accountantToken,
      body: {
        customerId: 'CUST-001',
        issueDate: '2026-10-26',
        items: [{ productId: 'PROD-001', quantity: 1, unitPrice: 10, vatRate: 20 }],
      },
    });
    assert(createInvRes.status === 403, 'Accountant cannot create an invoice (returns 403 Forbidden)', `Status: ${createInvRes.status}`);

    // Create a draft invoice using Admin to test modification restrictions
    const adminCreateInv = await request('/api/v1/invoices', {
      method: 'POST',
      token: adminToken,
      body: {
        customerId: 'CUST-001',
        issueDate: '2026-10-26',
        status: 'Draft',
        items: [{ productId: 'PROD-001', description: 'Vine Tomatoes', quantity: 5, unit: 'kg', unitPrice: 3.20, vatRate: 0 }],
      },
    });
    const testInvoiceId = adminCreateInv.data?.data?.id;

    if (testInvoiceId) {
      // 2. Cannot edit invoice
      const editInvRes = await request(`/api/v1/invoices/${testInvoiceId}`, {
        method: 'PUT',
        token: accountantToken,
        body: { notes: 'Attempted edit by accountant' },
      });
      assert(editInvRes.status === 403, 'Accountant cannot edit an invoice (returns 403 Forbidden)', `Status: ${editInvRes.status}`);

      // 3. Cannot finalize invoice
      const finalizeInvRes = await request(`/api/v1/invoices/${testInvoiceId}/finalize`, {
        method: 'POST',
        token: accountantToken,
      });
      assert(finalizeInvRes.status === 403, 'Accountant cannot finalize an invoice (returns 403 Forbidden)', `Status: ${finalizeInvRes.status}`);

      // 4. Cannot void invoice
      const voidInvRes = await request(`/api/v1/invoices/${testInvoiceId}/void`, {
        method: 'POST',
        token: accountantToken,
        body: { reason: 'Unauthorized void attempt' },
      });
      assert(voidInvRes.status === 403, 'Accountant cannot void an invoice (returns 403 Forbidden)', `Status: ${voidInvRes.status}`);

      // 5. Cannot delete invoice
      const deleteInvRes = await request(`/api/v1/invoices/${testInvoiceId}`, {
        method: 'DELETE',
        token: accountantToken,
      });
      assert(deleteInvRes.status === 403, 'Accountant cannot delete an invoice (returns 403 Forbidden)', `Status: ${deleteInvRes.status}`);
    } else {
      assert(false, 'Setup draft invoice for accountant test', 'Admin draft creation failed');
    }

    // ----------------------------------------------------
    // Section 5: Accountant Restricted Operations (Purchases & Orders)
    // ----------------------------------------------------
    console.log('\n📋 Test Group 5: Purchases & Orders Restrictions (Enforced)');

    // 1. Cannot create purchase
    const createPurchaseRes = await request('/api/v1/purchases', {
      method: 'POST',
      token: accountantToken,
      body: {
        supplierName: 'Covent Garden Wholesale',
        purchaseDate: '2026-10-26',
        items: [{ product: 'Potatoes', quantity: 10, unit: 'kg', unitCost: 1.0, vatRate: 0 }],
      },
    });
    assert(createPurchaseRes.status === 403, 'Accountant cannot create purchases (returns 403 Forbidden)', `Status: ${createPurchaseRes.status}`);

    // 2. Cannot create order
    const createOrderRes = await request('/api/v1/orders', {
      method: 'POST',
      token: accountantToken,
      body: {
        customerId: 'CUST-001',
        orderDate: '2026-10-26',
        items: [{ productId: 'PROD-001', quantity: 2 }],
      },
    });
    assert(createOrderRes.status === 403, 'Accountant cannot create orders (returns 403 Forbidden)', `Status: ${createOrderRes.status}`);

    // ----------------------------------------------------
    // Section 6: User Management Restrictions on Accountant
    // ----------------------------------------------------
    console.log('\n📋 Test Group 6: User Management Access Restrictions');

    // 1. Cannot list users
    const accListUsers = await request('/api/v1/users', { token: accountantToken });
    assert(accListUsers.status === 403, 'Accountant cannot list user accounts (returns 403 Forbidden)', `Status: ${accListUsers.status}`);

    // 2. Cannot create users
    const accCreateUser = await request('/api/v1/users', {
      method: 'POST',
      token: accountantToken,
      body: {
        name: 'Hacked User',
        email: 'hacked@hack.com',
        password: 'Password123!',
        role: 'admin',
      },
    });
    assert(accCreateUser.status === 403, 'Accountant cannot create user accounts (returns 403 Forbidden)', `Status: ${accCreateUser.status}`);

    // 3. Cannot escalate own role or modify own permissions
    const accSelfEscalate = await request(`/api/v1/users/${accountantLogin.data?.user?.id || 'USR-ACC'}`, {
      method: 'PUT',
      token: accountantToken,
      body: {
        role: 'admin',
        permissions: ['*'],
      },
    });
    assert(accSelfEscalate.status === 403, 'Accountant cannot modify their own role or permissions (returns 403 Forbidden)', `Status: ${accSelfEscalate.status}`);

    // ----------------------------------------------------
    // Section 7: Permission Persistence & Safe Failure
    // ----------------------------------------------------
    console.log('\n📋 Test Group 7: Persistence & Secure Failure Modes');

    // Login with the newly created and updated accountant
    const loginNewAcc = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: newAccountantEmail, password: 'Password123!' },
    });
    assert(loginNewAcc.status === 200, 'Newly created accountant logs in successfully');
    const newAccToken = loginNewAcc.data?.token;

    const newAccProfile = await request('/api/v1/auth/me', { token: newAccToken });
    assert(
      newAccProfile.data?.user?.effectivePermissions?.includes('reports:vat') &&
      !newAccProfile.data?.user?.effectivePermissions?.includes('invoices:create'),
      'Assigned permissions persist accurately across logout and re-login'
    );

    // Missing token or invalid credentials fail securely
    const unauthReq = await request('/api/v1/invoices', { method: 'POST' });
    assert(unauthReq.status === 401, 'Unauthenticated request to protected endpoint returns 401 Unauthorized');

    // Existing Admin workflows still fully functional
    const adminReportsRes = await request('/api/v1/reports/vat-return', { token: adminToken });
    assert(adminReportsRes.status === 200, 'Existing Admin workflows and reports continue to function seamlessly');

    // Admin can safely clean up test invoice
    if (testInvoiceId) {
      const cleanupInv = await request(`/api/v1/invoices/${testInvoiceId}`, {
        method: 'DELETE',
        token: adminToken,
      });
      assert(cleanupInv.status === 200, 'Admin can safely delete test draft invoice');
    }

  } catch (err) {
    console.error('Unexpected test exception:', err);
    failed++;
  } finally {
    server.close();
    await prisma.$disconnect();

    console.log('\n================================================================');
    console.log(`🏁 Verification Results: ${passed} Passed, ${failed} Failed`);
    console.log('================================================================');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runTests();
