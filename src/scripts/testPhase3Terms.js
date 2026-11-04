import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const BASE_URL = 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'lf_sec_dev_2026_98d7f3e8b4a2c1d0e5f6a7b8c9d0e1f2';

// ANSI color helpers
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function pass(name, detail = '') {
  console.log(`  ${colors.green}✓ PASS:${colors.reset} ${name}${detail ? ` (${detail})` : ''}`);
}

function fail(name, error) {
  console.error(`  ${colors.red}✗ FAIL:${colors.reset} ${name}`);
  if (error) console.error(`    ${colors.red}Error: ${error}${colors.reset}`);
}

async function run() {
  console.log(`\n${colors.bold}${colors.cyan}====================================================`);
  console.log(`  B3 INVOICES — PHASE 3 TERMS & CONDITIONS VERIFICATION`);
  console.log(`====================================================${colors.reset}\n`);

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  // Track created test IDs for safe cleanup
  const cleanup = {
    userIds: [],
    invitationIds: [],
    acceptanceIds: [],
    termsVersionIds: [],
  };

  try {
    // -------------------------------------------------------------------------
    // TEST SUITE 1: Database Schema & Initial Terms Seed
    // -------------------------------------------------------------------------
    console.log(`${colors.bold}--- Suite 1: Database Schema & Initial Seed ---${colors.reset}`);

    // Check tables exist
    totalTests++;
    try {
      const tables = await prisma.$queryRawUnsafe(`SHOW TABLES LIKE '%terms%'`);
      const tableNames = tables.map((t) => Object.values(t)[0]);
      if (tableNames.includes('terms_versions') && tableNames.includes('customer_terms_acceptances')) {
        pass('Terms database tables exist in MySQL ledgerflow_db', tableNames.join(', '));
        passedTests++;
      } else {
        throw new Error(`Missing expected tables: ${tableNames.join(', ')}`);
      }
    } catch (e) {
      fail('Terms database tables exist', e.message);
      failedTests++;
    }

    // Check active published draft 2026-v1.0 exists
    totalTests++;
    let initialPublishedTerms = null;
    try {
      initialPublishedTerms = await prisma.termsVersion.findFirst({
        where: { status: 'published' },
      });
      if (initialPublishedTerms && initialPublishedTerms.version === '2026-v1.0') {
        pass('Initial published Terms & Conditions version exists', `v${initialPublishedTerms.version}: "${initialPublishedTerms.title}"`);
        passedTests++;
      } else {
        throw new Error('Initial published version not found or not 2026-v1.0');
      }
    } catch (e) {
      fail('Initial published Terms & Conditions exists', e.message);
      failedTests++;
    }

    // -------------------------------------------------------------------------
    // TEST SUITE 2: Public Terms Endpoint
    // -------------------------------------------------------------------------
    console.log(`\n${colors.bold}--- Suite 2: Public Terms API (GET /api/v1/terms/current) ---${colors.reset}`);

    totalTests++;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/terms/current`);
      const data = await res.json();
      if (res.status === 200 && data.status === 'ok' && data.data?.terms?.version === '2026-v1.0') {
        pass('Unauthenticated visitor can fetch active Terms & Conditions', `Status: ${data.data.terms.status}, hasAccepted: ${data.data.hasAccepted}`);
        passedTests++;
      } else {
        throw new Error(`Unexpected response: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      fail('Unauthenticated visitor can fetch active Terms', e.message);
      failedTests++;
    }

    // -------------------------------------------------------------------------
    // TEST SUITE 3: New Customer Registration Terms Enforcement
    // -------------------------------------------------------------------------
    console.log(`\n${colors.bold}--- Suite 3: New Customer Registration Terms Enforcement ---${colors.reset}`);

    // Admin login to generate real invitation token via API
    const adminAuthRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@freshharvest.co.uk',
        password: '123456',
      }),
    });
    const adminAuthData = await adminAuthRes.json();
    const adminToken = adminAuthData.token;

    // Generate real single-use invitation token for CUST-001 via Admin API
    const genTokenRes = await fetch(`${BASE_URL}/api/v1/customers/CUST-001/invitation-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const genTokenData = await genTokenRes.json();
    const signedJwt = genTokenData.data?.token;
    if (genTokenData.data?.id) {
      cleanup.invitationIds.push(genTokenData.data.id);
    }

    // Test 3A: Registration without acceptTerms (must be rejected)
    totalTests++;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Decline Terms User',
          email: 'test_decline_terms@example.com',
          password: 'Password123!',
          invitationToken: signedJwt,
          acceptTerms: false,
        }),
      });
      const data = await res.json();
      if (res.status === 400 && data.code === 'TERMS_ACCEPTANCE_REQUIRED') {
        pass('Registration without Terms acceptance is rejected with 400 TERMS_ACCEPTANCE_REQUIRED');
        passedTests++;
      } else {
        throw new Error(`Expected 400 TERMS_ACCEPTANCE_REQUIRED, got ${res.status}: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      fail('Registration without Terms acceptance is rejected', e.message);
      failedTests++;
    }

    // Test 3B: Registration with acceptTerms: true (must succeed and atomically record acceptance)
    totalTests++;
    let newRegisteredUserId = null;
    let newCustomerToken = null;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Accepted Terms User',
          email: 'test_accepted_terms@example.com',
          password: 'Password123!',
          invitationToken: signedJwt,
          acceptTerms: true,
        }),
      });
      const data = await res.json();
      if (res.status === 201 && data.status === 'ok' && data.user?.id) {
        newRegisteredUserId = data.user.id;
        newCustomerToken = data.token;
        cleanup.userIds.push(newRegisteredUserId);

        // Verify acceptance was recorded in database
        const acceptance = await prisma.customerTermsAcceptance.findUnique({
          where: {
            userId_termsVersionId: {
              userId: newRegisteredUserId,
              termsVersionId: initialPublishedTerms.id,
            },
          },
        });

        if (acceptance && acceptance.acceptanceMethod === 'registration') {
          cleanup.acceptanceIds.push(acceptance.id);
          pass('Registration with Terms acceptance succeeds & records CustomerTermsAcceptance', `Method: ${acceptance.acceptanceMethod}, Version: ${acceptance.versionString}`);
          passedTests++;
        } else {
          throw new Error('CustomerTermsAcceptance record was not created during registration!');
        }
      } else {
        throw new Error(`Registration failed: ${res.status} ${JSON.stringify(data)}`);
      }
    } catch (e) {
      fail('Registration with Terms acceptance succeeds & records acceptance', e.message);
      failedTests++;
    }

    // Test 3C: Attempt to reuse consumed invitation
    totalTests++;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Duplicate User',
          email: 'test_duplicate@example.com',
          password: 'Password123!',
          invitationToken: signedJwt,
          acceptTerms: true,
        }),
      });
      const data = await res.json();
      if (res.status === 400 && data.code === 'INVITATION_ALREADY_USED') {
        pass('Reusing consumed invitation is strictly rejected with INVITATION_ALREADY_USED');
        passedTests++;
      } else {
        throw new Error(`Expected 400 INVITATION_ALREADY_USED, got ${res.status}: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      fail('Reusing consumed invitation is rejected', e.message);
      failedTests++;
    }

    // -------------------------------------------------------------------------
    // TEST SUITE 4: Existing Customer Login & Route Guard Enforcement
    // -------------------------------------------------------------------------
    console.log(`\n${colors.bold}--- Suite 4: Existing Customer Portal & Route Guard Enforcement ---${colors.reset}`);

    // Create an existing customer user who has NOT accepted terms yet
    const existingCustPasswordHash = await bcrypt.hash('123456', 10);
    const existingTestUser = await prisma.user.create({
      data: {
        email: 'test_existing_cust@example.com',
        name: 'Existing Client Unaccepted',
        passwordHash: existingCustPasswordHash,
        role: 'customer',
        customerId: 'CUST-001',
        isActive: true,
      },
    });
    cleanup.userIds.push(existingTestUser.id);

    // Test 4A: Login as existing customer without terms acceptance
    totalTests++;
    let existingCustToken = null;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test_existing_cust@example.com',
          password: '123456',
        }),
      });
      const data = await res.json();
      existingCustToken = data.token;
      if (
        res.status === 200 &&
        data.user?.termsAcceptance?.required === true &&
        data.user?.termsAcceptance?.hasAccepted === false
      ) {
        pass('Login detects customer has NOT accepted terms', `hasAccepted: false, required: true`);
        passedTests++;
      } else {
        throw new Error(`Unexpected login response: ${JSON.stringify(data.user?.termsAcceptance)}`);
      }
    } catch (e) {
      fail('Login detects customer has not accepted terms', e.message);
      failedTests++;
    }

    // Test 4B: Server-Side Route Guard blocks protected customer statement route
    totalTests++;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/customers/CUST-001/statement`, {
        headers: { Authorization: `Bearer ${existingCustToken}` },
      });
      const data = await res.json();
      if (res.status === 403 && data.code === 'TERMS_ACCEPTANCE_REQUIRED') {
        pass('Route guard blocks customer statement access before terms acceptance (403 TERMS_ACCEPTANCE_REQUIRED)');
        passedTests++;
      } else {
        throw new Error(`Expected 403 TERMS_ACCEPTANCE_REQUIRED, got ${res.status}: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      fail('Route guard blocks customer statement access before acceptance', e.message);
      failedTests++;
    }

    // Test 4C: Customer explicitly accepts terms via POST /api/v1/terms/accept
    totalTests++;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/terms/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${existingCustToken}`,
        },
        body: JSON.stringify({
          termsVersionId: initialPublishedTerms.id,
          acceptanceMethod: 'portal_prompt',
        }),
      });
      const data = await res.json();
      if (res.status === 201 && data.status === 'ok' && data.data?.id) {
        cleanup.acceptanceIds.push(data.data.id);
        pass('Customer accepts terms via POST /api/v1/terms/accept', `ID: ${data.data.id}, Method: ${data.data.acceptanceMethod}`);
        passedTests++;
      } else {
        throw new Error(`Terms accept failed: ${res.status} ${JSON.stringify(data)}`);
      }
    } catch (e) {
      fail('Customer accepts terms via POST /api/v1/terms/accept', e.message);
      failedTests++;
    }

    // Test 4D: Duplicate acceptance is handled idempotently
    totalTests++;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/terms/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${existingCustToken}`,
        },
        body: JSON.stringify({
          termsVersionId: initialPublishedTerms.id,
          acceptanceMethod: 'portal_prompt',
        }),
      });
      const data = await res.json();
      if (res.status === 200 && data.status === 'ok') {
        pass('Subsequent duplicate acceptance handled idempotently with 200 OK');
        passedTests++;
      } else {
        throw new Error(`Expected 200 OK, got ${res.status}: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      fail('Duplicate acceptance handled idempotently', e.message);
      failedTests++;
    }

    // Test 4E: Server-Side Route Guard unblocked after acceptance
    totalTests++;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/customers/CUST-001/statement`, {
        headers: { Authorization: `Bearer ${existingCustToken}` },
      });
      const data = await res.json();
      if (res.status === 200 && data.status === 'ok') {
        pass('Route guard grants full access to customer statement after terms acceptance', `Balance: £${data.data?.statementSummary?.outstandingBalance ?? '0'}`);
        passedTests++;
      } else {
        throw new Error(`Expected 200 OK, got ${res.status}: ${JSON.stringify(data)}`);
      }
    } catch (e) {
      fail('Route guard grants access after acceptance', e.message);
      failedTests++;
    }

    // -------------------------------------------------------------------------
    // TEST SUITE 5: Admin Terms Management & Version Publishing
    // -------------------------------------------------------------------------
    console.log(`\n${colors.bold}--- Suite 5: Admin Terms Management & Version Publishing ---${colors.reset}`);

    // Suite 5 uses existing adminToken from Suite 3

    // Test 5A: Admin creates new draft version
    totalTests++;
    let testDraftId = null;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/terms/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          version: '2026-v2.0-test',
          title: 'B3 Invoices Customer Terms — Updated Produce Quality Clauses',
          content: 'Test updated wholesale clauses draft content.',
          requiresReacceptance: true,
        }),
      });
      const data = await res.json();
      if (res.status === 201 && data.status === 'ok' && data.data?.id) {
        testDraftId = data.data.id;
        cleanup.termsVersionIds.push(testDraftId);
        pass('Admin creates new draft terms version', `Version: ${data.data.version}, Status: ${data.data.status}`);
        passedTests++;
      } else {
        throw new Error(`Create draft failed: ${res.status} ${JSON.stringify(data)}`);
      }
    } catch (e) {
      fail('Admin creates new draft terms version', e.message);
      failedTests++;
    }

    // Test 5B: Admin updates draft
    totalTests++;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/terms/versions/${testDraftId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          title: 'B3 Invoices Customer Terms — Revised 2026 Produce Agreements',
        }),
      });
      const data = await res.json();
      if (res.status === 200 && data.status === 'ok' && data.data?.title.includes('Revised')) {
        pass('Admin updates draft title & content', data.data.title);
        passedTests++;
      } else {
        throw new Error(`Update draft failed: ${res.status} ${JSON.stringify(data)}`);
      }
    } catch (e) {
      fail('Admin updates draft', e.message);
      failedTests++;
    }

    // Test 5C: Admin publishes draft version
    totalTests++;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/terms/versions/${testDraftId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const data = await res.json();
      if (res.status === 200 && data.status === 'ok' && data.data?.status === 'published') {
        pass('Admin publishes draft version (prior version transitioned to archived)');
        passedTests++;
      } else {
        throw new Error(`Publish failed: ${res.status} ${JSON.stringify(data)}`);
      }
    } catch (e) {
      fail('Admin publishes draft version', e.message);
      failedTests++;
    }

    // Test 5D: Customer now requires re-acceptance for the new version
    totalTests++;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/terms/current`, {
        headers: { Authorization: `Bearer ${existingCustToken}` },
      });
      const data = await res.json();
      if (
        res.status === 200 &&
        data.data?.terms?.version === '2026-v2.0-test' &&
        data.data?.hasAccepted === false
      ) {
        pass('Re-acceptance enforced: customer hasAccepted is false on newly published version');
        passedTests++;
      } else {
        throw new Error(`Expected hasAccepted: false, got ${JSON.stringify(data.data)}`);
      }
    } catch (e) {
      fail('Re-acceptance enforced on new published version', e.message);
      failedTests++;
    }

    // Test 5E: Restore 2026-v1.0 as active published version
    totalTests++;
    try {
      await fetch(`${BASE_URL}/api/v1/terms/versions/${initialPublishedTerms.id}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const res = await fetch(`${BASE_URL}/api/v1/terms/current`);
      const data = await res.json();
      if (data.data?.terms?.version === '2026-v1.0') {
        pass('Re-published stable version 2026-v1.0 as active');
        passedTests++;
      } else {
        throw new Error(`Active version is ${data.data?.terms?.version}, expected 2026-v1.0`);
      }
    } catch (e) {
      fail('Restore 2026-v1.0 as active', e.message);
      failedTests++;
    }

    // Test 5F: Admin views customer acceptance audit records
    totalTests++;
    try {
      const res = await fetch(`${BASE_URL}/api/v1/terms/acceptances`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const data = await res.json();
      if (res.status === 200 && Array.isArray(data.data) && data.data.length > 0) {
        pass('Admin views customer acceptance audit log', `Found ${data.data.length} records`);
        passedTests++;
      } else {
        throw new Error(`Audit log fetch failed: ${res.status} ${JSON.stringify(data)}`);
      }
    } catch (e) {
      fail('Admin views customer acceptance audit log', e.message);
      failedTests++;
    }

  } finally {
    // -------------------------------------------------------------------------
    // CLEANUP OF DISPOSABLE TEST RECORDS
    // -------------------------------------------------------------------------
    console.log(`\n${colors.bold}--- Cleanup: Removing Disposable Test Records ---${colors.reset}`);

    try {
      if (cleanup.acceptanceIds.length > 0) {
        await prisma.customerTermsAcceptance.deleteMany({
          where: { id: { in: cleanup.acceptanceIds } },
        });
        console.log(`  Cleaned up ${cleanup.acceptanceIds.length} test terms acceptances.`);
      }

      if (cleanup.termsVersionIds.length > 0) {
        await prisma.termsVersion.deleteMany({
          where: { id: { in: cleanup.termsVersionIds } },
        });
        console.log(`  Cleaned up ${cleanup.termsVersionIds.length} test terms versions.`);
      }

      if (cleanup.userIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: cleanup.userIds } },
        });
        console.log(`  Cleaned up ${cleanup.userIds.length} test users.`);
      }

      if (cleanup.invitationIds.length > 0) {
        await prisma.customerInvitation.deleteMany({
          where: { id: { in: cleanup.invitationIds } },
        });
        console.log(`  Cleaned up ${cleanup.invitationIds.length} test customer invitations.`);
      }
    } catch (cleanupErr) {
      console.warn('  Cleanup warning:', cleanupErr.message);
    }

    await prisma.$disconnect();
  }

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log(`\n${colors.bold}====================================================`);
  console.log(`  FINAL VERIFICATION SUMMARY`);
  console.log(`====================================================${colors.reset}`);
  console.log(`  Total Tests Run: ${totalTests}`);
  console.log(`  ${colors.green}Passed: ${passedTests}${colors.reset}`);
  console.log(`  ${failedTests === 0 ? colors.green : colors.red}Failed: ${failedTests}${colors.reset}`);

  if (failedTests === 0) {
    console.log(`\n${colors.bold}${colors.green}🎉 ALL PHASE 3 TERMS & CONDITIONS VERIFICATION TESTS PASSED!${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${colors.bold}${colors.red}❌ SOME VERIFICATION TESTS FAILED.${colors.reset}\n`);
    process.exit(1);
  }
}

run();
