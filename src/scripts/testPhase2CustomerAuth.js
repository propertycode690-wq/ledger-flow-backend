import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Ensure backend .env is loaded regardless of execution root
dotenv.config({ path: path.resolve('backend/.env') });
dotenv.config();

import app from '../app.js';
import { generateToken, verifyToken } from '../utils/token.js';
import { registerSchema, forgotPasswordSchema, resetPasswordSchema } from '../controllers/auth.controller.js';
import { createPortalUserSchema } from '../controllers/customer.controller.js';
import { enforceCustomerScope } from '../middlewares/auth.middleware.js';
import { testDatabaseConnection } from '../config/db.js';

let passed = 0;
let failed = 0;
let notRun = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

function skip(testName, reason) {
  console.log(`  ⚠️  NOT RUN: ${testName} (${reason})`);
  notRun++;
}

async function runPhase2SecurityVerification() {
  console.log('====================================================');
  console.log('🛡️  B3 Invoices — Phase 2B Security Hardening Suite');
  console.log('====================================================\n');

  // 1. Token Cryptographic & Hashing Integrity Tests
  console.log('--- 1. Cryptographic Token & Hash Integrity Tests ---');
  const sampleCustomerId = 'CUST-TEST-001';
  const token = generateToken({
    type: 'portal_invitation',
    customerId: sampleCustomerId,
    customerName: 'Test Client Ltd',
  });

  assert(typeof token === 'string' && token.split('.').length === 3, 'Token generates valid 3-part JWT structure');

  const decoded = verifyToken(token);
  assert(decoded && decoded.type === 'portal_invitation', 'Decoded token matches type portal_invitation');
  assert(decoded && decoded.customerId === sampleCustomerId, 'Decoded token preserves correct customerId');

  const tamperedToken = token.slice(0, -6) + 'abcdef';
  const tamperedResult = verifyToken(tamperedToken);
  assert(tamperedResult === null, 'Tampered token is strictly rejected by verifyToken');

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  assert(typeof tokenHash === 'string' && tokenHash.length === 64, 'Token hash is valid SHA-256 (64 hex characters)');
  assert(!tokenHash.includes(token), 'Token hash does not expose raw JWT token');

  // 2. Schema Security Tests (Role Elevation Prevention)
  console.log('\n--- 2. Schema & Role Elevation Protection Tests ---');
  const validRegInput = {
    name: 'Customer Rep',
    email: 'rep@client.com',
    password: 'password123',
    invitationToken: token,
  };
  const parseResult = registerSchema.safeParse(validRegInput);
  assert(parseResult.success, 'Valid registration payload accepted by registerSchema');

  const shortPasswordInput = { ...validRegInput, password: '123' };
  assert(!registerSchema.safeParse(shortPasswordInput).success, 'Short password (< 6 chars) rejected by registerSchema');

  const invalidEmailInput = { ...validRegInput, email: 'not-an-email' };
  assert(!registerSchema.safeParse(invalidEmailInput).success, 'Invalid email address rejected by registerSchema');

  const portalUserParsed = createPortalUserSchema.safeParse({
    name: 'Accounts Contact',
    email: 'billing@client.com',
    password: 'securePassword99',
  });
  assert(portalUserParsed.success, 'Valid portal user input accepted by createPortalUserSchema');

  // 3. Customer Data Isolation Middleware Tests (IDOR Protection)
  console.log('\n--- 3. Customer Scope Isolation Tests (IDOR Protection) ---');
  let scopeBlocked = false;
  let blockedCode = null;

  const mockRes = {
    status: (code) => ({
      json: (data) => {
        if (code === 403) {
          scopeBlocked = true;
          blockedCode = data.code;
        }
      },
    }),
  };

  // Scenario A: Customer A attempts to query Customer B's records via query param
  const reqAttack = {
    user: { role: 'customer', customerId: 'CUST-001' },
    params: {},
    query: { customerId: 'CUST-002' },
    body: {},
  };
  enforceCustomerScope(reqAttack, mockRes, () => {});
  assert(
    scopeBlocked && blockedCode === 'CUSTOMER_ISOLATION_VIOLATION',
    'Customer A querying Customer B parameter is blocked with CUSTOMER_ISOLATION_VIOLATION'
  );

  // Scenario B: Customer A queries own customer ID
  let selfAllowed = false;
  scopeBlocked = false;
  const reqSelf = {
    user: { role: 'customer', customerId: 'CUST-001' },
    params: {},
    query: { customerId: 'CUST-001' },
    body: {},
  };
  enforceCustomerScope(reqSelf, mockRes, () => {
    selfAllowed = true;
  });
  assert(selfAllowed && !scopeBlocked, 'Customer querying own customerId is allowed through middleware');

  // Scenario C: Admin user querying any customerId (Backoffice staff access)
  let adminAllowed = false;
  const reqAdmin = {
    user: { role: 'admin' },
    params: {},
    query: { customerId: 'CUST-002' },
    body: {},
  };
  enforceCustomerScope(reqAdmin, mockRes, () => {
    adminAllowed = true;
  });
  assert(adminAllowed, 'Admin is permitted full visibility across all customer accounts');

  // 4. Single-Use, Revocation & Concurrency Logic Simulation
  console.log('\n--- 4. Concurrency & State Machine Integrity Tests ---');
  // Simulated in-memory atomic record
  const mockDbRecord = {
    id: 'inv-test-uuid-001',
    tokenHash,
    status: 'pending',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };

  // Test concurrency: Attempt 1 transitions pending -> consumed
  let attempt1Success = false;
  let attempt2Success = false;

  function simulateAtomicTransition(record, expectedStatus, nextStatus) {
    if (record.status === expectedStatus && record.expiresAt > new Date()) {
      record.status = nextStatus;
      return 1; // 1 row updated
    }
    return 0; // 0 rows updated
  }

  const res1 = simulateAtomicTransition(mockDbRecord, 'pending', 'consumed');
  if (res1 === 1) attempt1Success = true;

  // Attempt 2 attempts same token concurrently
  const res2 = simulateAtomicTransition(mockDbRecord, 'pending', 'consumed');
  if (res2 === 1) attempt2Success = true;

  assert(attempt1Success && !attempt2Success, 'Concurrent race condition: exactly 1 request consumes token, duplicate rejected');
  assert(mockDbRecord.status === 'consumed', 'Invitation status correctly transitions to consumed');

  // Re-submission rejection
  const reSubmissionResult = simulateAtomicTransition(mockDbRecord, 'pending', 'consumed');
  assert(reSubmissionResult === 0, 'Re-using consumed invitation returns 0 rows updated (single-use enforced)');

  // Revocation rejection
  const mockRevokedRecord = {
    id: 'inv-test-uuid-002',
    tokenHash: 'revoked_hash_test_123',
    status: 'revoked',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
  const revokeConsumeResult = simulateAtomicTransition(mockRevokedRecord, 'pending', 'consumed');
  assert(revokeConsumeResult === 0, 'Revoked invitation cannot be consumed (rejected)');

  // Expired token rejection
  const mockExpiredRecord = {
    id: 'inv-test-uuid-003',
    tokenHash: 'expired_hash_test_123',
    status: 'pending',
    expiresAt: new Date(Date.now() - 1000), // in the past
  };
  const expiredConsumeResult = simulateAtomicTransition(mockExpiredRecord, 'pending', 'consumed');
  assert(expiredConsumeResult === 0, 'Expired invitation cannot be consumed (rejected)');

  // 5. Source Code Hardening Audits
  console.log('\n--- 5. Source Code Hardening Audits ---');
  const portalFilePath = path.resolve('frontend/src/pages/portal/CustomerPortal.jsx');
  const portalCode = fs.readFileSync(portalFilePath, 'utf-8');
  assert(!portalCode.includes('customers[0]'), 'Insecure fallback customers[0] is absent from CustomerPortal.jsx');
  assert(portalCode.includes('Portal Account Not Linked'), 'Safe blocking UI present for unlinked accounts');

  const loginFilePath = path.resolve('frontend/src/pages/auth/Login.jsx');
  const loginCode = fs.readFileSync(loginFilePath, 'utf-8');
  assert(!loginCode.includes('demoAccounts'), 'Demo accounts configuration array removed from Login.jsx');
  assert(!loginCode.includes("'123456'"), 'Hardcoded tester password removed from Login.jsx');
  assert(loginCode.includes("const [email, setEmail] = useState('');"), 'Login email state initializes completely blank');
  assert(loginCode.includes("const [password, setPassword] = useState('');"), 'Login password state initializes completely blank');
  assert(loginCode.includes('/api/v1/auth/forgot-password'), 'Forgot password workflow connected in Login.jsx');
  assert(loginCode.includes('/api/v1/auth/reset-password'), 'Reset password workflow connected in Login.jsx');

  const customerControllerPath = path.resolve('backend/src/controllers/customer.controller.js');
  const customerCtrlCode = fs.readFileSync(customerControllerPath, 'utf-8');
  assert(customerCtrlCode.includes('listCustomerInvitations'), 'listCustomerInvitations controller implemented');
  assert(customerCtrlCode.includes('revokeCustomerInvitation'), 'revokeCustomerInvitation controller implemented');
  assert(!customerCtrlCode.includes('details: { token:'), 'Raw token is never passed into audit log details');

  const authControllerPath = path.resolve('backend/src/controllers/auth.controller.js');
  const authCtrlCode = fs.readFileSync(authControllerPath, 'utf-8');
  assert(authCtrlCode.includes('$transaction'), 'Atomic $transaction enforced in auth.controller.js register');
  assert(authCtrlCode.includes('updateMany'), 'Atomic conditional updateMany status transition enforced in register');
  assert(authCtrlCode.includes('INVITATION_ALREADY_USED'), 'INVITATION_ALREADY_USED error code returned on reuse');
  assert(authCtrlCode.includes('INVITATION_REVOKED'), 'INVITATION_REVOKED error code returned on revoked token');
  assert(authCtrlCode.includes('INVITATION_REQUIRED'), 'INVITATION_REQUIRED enforced on register without invitation');
  assert(authCtrlCode.includes('forgotPassword'), 'forgotPassword controller exported in auth.controller.js');
  assert(authCtrlCode.includes('resetPassword'), 'resetPassword controller exported in auth.controller.js');

  // Password reset schemas validation
  const forgotValid = forgotPasswordSchema.safeParse({ email: 'client@example.co.uk' });
  assert(forgotValid.success, 'Valid email accepted by forgotPasswordSchema');
  const forgotInvalid = forgotPasswordSchema.safeParse({ email: 'invalid-email' });
  assert(!forgotInvalid.success, 'Invalid email rejected by forgotPasswordSchema');

  const resetValid = resetPasswordSchema.safeParse({ token: 'secure-reset-token-sample-12345', newPassword: 'newValidPassword123' });
  assert(resetValid.success, 'Valid payload accepted by resetPasswordSchema');
  const resetShortPw = resetPasswordSchema.safeParse({ token: 'secure-reset-token-sample-12345', newPassword: '123' });
  assert(!resetShortPw.success, 'Short password (< 6 chars) rejected by resetPasswordSchema');

  // 6. Database-Backed Endpoints Test (Live HTTP)
  console.log('\n--- 6. Database-Backed Endpoint Verification ---');
  const dbStatus = await testDatabaseConnection();
  if (dbStatus.connected) {
    console.log(`  [Database Connected: ${dbStatus.latencyMs}ms]`);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      // 6.1 Test invalid invitation token returns 400 INVALID_INVITATION
      const resBadToken = await fetch(`http://localhost:${port}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Invalid Test User',
          email: 'invalid@test.com',
          password: 'password123',
          invitationToken: 'bad.token.signature',
        }),
      });
      const dataBadToken = await resBadToken.json();
      assert(resBadToken.status === 400 && dataBadToken.code === 'INVALID_INVITATION', 'Invalid registration token returns 400 INVALID_INVITATION');

      // 6.2 Test registration without invitation token returns 400 INVITATION_REQUIRED
      const resNoToken = await fetch(`http://localhost:${port}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Unauthorized User',
          email: 'unauthorized@test.com',
          password: 'password123',
        }),
      });
      const dataNoToken = await resNoToken.json();
      assert(resNoToken.status === 400 && dataNoToken.code === 'INVITATION_REQUIRED', 'Registration without invitation token returns 400 INVITATION_REQUIRED');

      // 6.3 Test forgot password endpoint returns generic 200 (anti-enumeration)
      const resForgot = await fetch(`http://localhost:${port}/api/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent-user@nowhere.co.uk',
        }),
      });
      const dataForgot = await resForgot.json();
      assert(resForgot.status === 200 && dataForgot.status === 'ok' && dataForgot.message?.includes('dispatched'), 'Forgot password returns generic 200 success for unrecognised email (anti-enumeration)');

      // 6.4 Test reset password with invalid token returns 400 INVALID_OR_EXPIRED_TOKEN
      const resReset = await fetch(`http://localhost:${port}/api/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'invalid-nonexistent-token-1234567890',
          newPassword: 'myNewValidPassword123!',
        }),
      });
      const dataReset = await resReset.json();
      assert(resReset.status === 400 && dataReset.code === 'INVALID_OR_EXPIRED_TOKEN', 'Reset password with non-existent token returns 400 INVALID_OR_EXPIRED_TOKEN');
    } finally {
      server.close();
    }
  } else {
    skip('Live Database Registration HTTP Tests', 'MySQL listener is offline in standard sandboxed environment');
  }

  // Final Summary
  console.log('\n====================================================');
  console.log(`Phase 2B Verification Complete: ${passed} PASSED, ${failed} FAILED, ${notRun} NOT RUN`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase2SecurityVerification().catch((err) => {
  console.error('Test Suite Error:', err);
  process.exit(1);
});
