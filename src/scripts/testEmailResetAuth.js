import http from 'http';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config({ path: path.resolve('backend/.env') });
dotenv.config();

import app from '../app.js';
import prisma, { testDatabaseConnection } from '../config/db.js';
import { getResendClient, sendPasswordResetEmail } from '../services/email.service.js';

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

async function runEmailAndResetTests() {
  console.log('====================================================');
  console.log('📧 B3 Invoices — Email & Password Reset Test Suite');
  console.log('====================================================\n');

  // 1. Missing API Key Validation
  console.log('--- 1. Missing API Key Validation Tests ---');
  const originalKey = process.env.RESEND_API_KEY;
  try {
    delete process.env.RESEND_API_KEY;
    let thrownError = null;
    try {
      getResendClient();
    } catch (e) {
      thrownError = e;
    }
    assert(thrownError && thrownError.code === 'MISSING_API_KEY', 'getResendClient throws MISSING_API_KEY when env var is absent');

    let sendError = null;
    try {
      await sendPasswordResetEmail({ to: 'test@example.com', resetToken: 'sampletoken1234567890' });
    } catch (e) {
      sendError = e;
    }
    assert(sendError && sendError.code === 'MISSING_API_KEY', 'sendPasswordResetEmail rejects when RESEND_API_KEY is missing');
  } finally {
    if (originalKey) {
      process.env.RESEND_API_KEY = originalKey;
    } else {
      delete process.env.RESEND_API_KEY;
    }
  }

  // 2. Email Service Input Validation
  console.log('\n--- 2. Email Service Input Validation Tests ---');
  let invalidToError = null;
  try {
    await sendPasswordResetEmail({ to: '', resetToken: 'validtoken1234567890' });
  } catch (e) {
    invalidToError = e;
  }
  assert(invalidToError && invalidToError.code === 'INVALID_RECIPIENT', 'sendPasswordResetEmail rejects empty recipient address');

  let invalidTokenError = null;
  try {
    await sendPasswordResetEmail({ to: 'test@example.com', resetToken: '' });
  } catch (e) {
    invalidTokenError = e;
  }
  assert(invalidTokenError && invalidTokenError.code === 'INVALID_TOKEN', 'sendPasswordResetEmail rejects empty reset token');

  // 3. Simulated Provider Failure (Invalid API Key)
  console.log('\n--- 3. Email Provider Failure Handling Tests ---');
  process.env.RESEND_API_KEY = 're_simulated_invalid_key_999999999';
  let providerFailure = null;
  try {
    await sendPasswordResetEmail({ to: 'recipient@example.com', resetToken: 'token12345678901234567890' });
  } catch (e) {
    providerFailure = e;
  }
  assert(providerFailure && (providerFailure.code === 'RESEND_API_ERROR' || providerFailure.message), 'Invalid API key produces clean provider failure exception without crashing');

  // Restore or set env
  if (originalKey) {
    process.env.RESEND_API_KEY = originalKey;
  } else {
    delete process.env.RESEND_API_KEY;
  }

  // 4. Database-Backed Forgot & Reset Endpoints
  console.log('\n--- 4. Database & HTTP Flow Tests ---');
  const dbStatus = await testDatabaseConnection();
  if (!dbStatus.connected) {
    skip('Database & HTTP Endpoint Tests', 'Database listener offline');
    printSummary();
    return;
  }
  console.log(`  [Database Connected: ${dbStatus.latencyMs}ms]`);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 4.1 Anti-enumeration: Unrecognized email returns generic 200
    const resUnregistered = await fetch(`http://localhost:${port}/api/v1/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'absolutely-non-existent-user-12345@nowhere.co.uk' }),
    });
    const dataUnregistered = await resUnregistered.json();
    assert(resUnregistered.status === 200 && dataUnregistered.status === 'ok', 'Unregistered email returns generic 200 (anti-enumeration)');
    assert(dataUnregistered.message?.includes('dispatched'), 'Generic message contains neutral dispatched wording');

    // 4.2 Missing API key configuration handling on registered user
    delete process.env.RESEND_API_KEY;
    const resRegisteredNoKey = await fetch(`http://localhost:${port}/api/v1/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@freshharvest.co.uk' }),
    });
    const dataRegisteredNoKey = await resRegisteredNoKey.json();
    assert(resRegisteredNoKey.status === 500 && dataRegisteredNoKey.code === 'EMAIL_CONFIG_MISSING', 'Registered user with missing API key returns 500 EMAIL_CONFIG_MISSING');

    // 4.3 Invalid API key provider rejection handling on registered user
    process.env.RESEND_API_KEY = 're_invalid_mock_key_00000000000000';
    const resRegisteredBadKey = await fetch(`http://localhost:${port}/api/v1/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@freshharvest.co.uk' }),
    });
    const dataRegisteredBadKey = await resRegisteredBadKey.json();
    assert(resRegisteredBadKey.status === 502 && dataRegisteredBadKey.code === 'EMAIL_DELIVERY_FAILED', 'Provider rejection returns 502 EMAIL_DELIVERY_FAILED without false success claim');

    // Restore key
    if (originalKey) process.env.RESEND_API_KEY = originalKey;
    else delete process.env.RESEND_API_KEY;

    // 4.4 Reset Password Token Lifecycle Tests
    console.log('\n--- 5. Reset Password Token State Machine Tests ---');
    // Setup test user and tokens directly in DB
    const testEmail = 'reset-test-user@b3invoices.test';
    let testUser = await prisma.user.findUnique({ where: { email: testEmail } });
    if (!testUser) {
      testUser = await prisma.user.create({
        data: {
          email: testEmail,
          passwordHash: await bcrypt.hash('InitialPassword123!', 12),
          role: 'customer',
          name: 'Reset Test User',
          title: 'Client Rep',
          isActive: true,
        },
      });
    }

    // 5.1 Invalid token format / non-existent token
    const resBadToken = await fetch(`http://localhost:${port}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'nonexistent-token-string-00000000000000', newPassword: 'BrandNewPassword123!' }),
    });
    const dataBadToken = await resBadToken.json();
    assert(resBadToken.status === 400 && dataBadToken.code === 'INVALID_OR_EXPIRED_TOKEN', 'Non-existent token rejected with 400 INVALID_OR_EXPIRED_TOKEN');

    // 5.2 Short password validation
    const resShortPw = await fetch(`http://localhost:${port}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'any-token-string-0000000000000000000', newPassword: '123' }),
    });
    assert(resShortPw.status === 400, 'New password shorter than 6 characters rejected with 400');

    // 5.3 Create a valid pending token
    const validRawToken = crypto.randomBytes(32).toString('hex');
    const validTokenHash = crypto.createHash('sha256').update(validRawToken).digest('hex');
    await prisma.passwordResetToken.create({
      data: {
        tokenHash: validTokenHash,
        userId: testUser.id,
        status: 'pending',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 60 min
      },
    });

    // Reset password with valid token
    const resValidReset = await fetch(`http://localhost:${port}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: validRawToken, newPassword: 'UpdatedSecurePassword2026!' }),
    });
    const dataValidReset = await resValidReset.json();
    assert(resValidReset.status === 200 && dataValidReset.status === 'ok', 'Valid reset token successfully updates user password');

    // Verify token is now marked 'used'
    const consumedTokenRecord = await prisma.passwordResetToken.findUnique({ where: { tokenHash: validTokenHash } });
    assert(consumedTokenRecord && consumedTokenRecord.status === 'used', 'Reset token status atomically transitioned to used');

    // 5.4 Replay attack: Attempting to reuse the consumed token
    const resReplay = await fetch(`http://localhost:${port}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: validRawToken, newPassword: 'AnotherPassword999!' }),
    });
    const dataReplay = await resReplay.json();
    assert(resReplay.status === 400 && dataReplay.code === 'TOKEN_ALREADY_USED', 'Reusing consumed token rejected with 400 TOKEN_ALREADY_USED');

    // 5.5 Expired token test
    const expiredRawToken = crypto.randomBytes(32).toString('hex');
    const expiredTokenHash = crypto.createHash('sha256').update(expiredRawToken).digest('hex');
    await prisma.passwordResetToken.create({
      data: {
        tokenHash: expiredTokenHash,
        userId: testUser.id,
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000), // in the past
      },
    });

    const resExpired = await fetch(`http://localhost:${port}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: expiredRawToken, newPassword: 'ExpiredTestPassword123!' }),
    });
    const dataExpired = await resExpired.json();
    assert(resExpired.status === 400 && dataExpired.code === 'TOKEN_EXPIRED', 'Expired token rejected with 400 TOKEN_EXPIRED');

    // 5.6 Login with new password works
    const resNewLogin = await fetch(`http://localhost:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'UpdatedSecurePassword2026!' }),
    });
    assert(resNewLogin.status === 200, 'User can successfully log in using newly updated password');

    // 5.7 Login with old password fails
    const resOldLogin = await fetch(`http://localhost:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'InitialPassword123!' }),
    });
    assert(resOldLogin.status === 401, 'User cannot log in with previous old password');

    // Cleanup disposable test user
    await prisma.passwordResetToken.deleteMany({ where: { userId: testUser.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  } finally {
    server.close();
  }

  printSummary();
}

function printSummary() {
  console.log('\n====================================================');
  console.log(`Test Suite Summary: ${passed} PASSED, ${failed} FAILED, ${notRun} NOT RUN`);
  console.log('====================================================');
  if (failed > 0) process.exit(1);
}

runEmailAndResetTests().catch((err) => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});

