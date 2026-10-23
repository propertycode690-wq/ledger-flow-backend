# LedgerFlow Backend Implementation Plan

This document outlines the multi-phase engineering plan for building the LedgerFlow Invoice System backend service.

---

## Progress Overview

| Phase | Description | Status |
|---|---|---|
| **Phase 1** | Initial Backend Setup & Database Connectivity | **COMPLETED & VERIFIED** |
| **Phase 2** | MySQL Schema & Secure Authentication (RBAC) | **COMPLETED & VERIFIED** |
| **Phase 3** | Customer, Product & Van Management APIs | **COMPLETED & VERIFIED** |
| **Phase 4** | Invoicing & Payment Engine (ACID Transactions) | **COMPLETED & VERIFIED** |
| **Phase 5** | Operations (Daily Orders, Van Aggregation, Mileage) | **COMPLETED & VERIFIED** |
| **Phase 6** | Accounting, VAT & Reports | *Pending* |
| **Phase 7** | Frontend Integration, CORS & Production Deployment | *Pending* |

---

## Phase 1: Initial Backend Setup & Database Connectivity
- [x] Initialized Node.js backend workspace in `backend/` with ES Modules (`type: module`).
- [x] Configured Express.js server and Prisma ORM targeting MySQL on XAMPP.
- [x] Created environment configuration (`.env.example` and local `.env`).
- [x] Implemented and verified `/api/health` and `/api/db-health`.

---

## Phase 2: MySQL Schema & Secure Authentication (RBAC)

### Scope & Goals
- Design and apply initial Prisma MySQL schema for `Van`, `Customer`, `User`, and `BusinessSettings`.
- Implement production-grade authentication with `bcryptjs` password hashing and signed JWTs.
- Support HTTP-Only cookies and Bearer token headers.
- Implement server-side Role-Based Access Control (`admin`, `accountant`, `customer`).
- Implement customer account isolation preventing cross-customer data access.
- Execute automated verification suite covering all 23 security assertions.

### Task Checklist
- [x] Designed Prisma schema models for `Van`, `Customer`, `User`, and `BusinessSettings`.
- [x] Verified existing `ledgerflow_db` tables before applying migrations.
- [x] Created and applied Prisma migration `20261019063216_init_phase2_auth_core`.
- [x] Generated Prisma Client bindings.
- [x] Created baseline seed script (`prisma/seed.js`) generating verified accounts with 12-round salted bcrypt hashes.
- [x] Implemented JWT generation and cookie options in `src/utils/token.js`.
- [x] Implemented `requireAuth`, `requireRole`, and `enforceCustomerScope` middlewares in `src/middlewares/auth.middleware.js`.
- [x] Implemented input validation with Zod in `src/middlewares/validate.middleware.js`.
- [x] Implemented `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, and `POST /api/v1/auth/logout` in `src/controllers/auth.controller.js`.
- [x] Mounted `cookie-parser` and `/api/v1/auth` routes in `src/app.js`.
- [x] Built and executed automated test suite (`src/scripts/testPhase2.js`): **23/23 tests passed**.
- [x] Updated all documentation files (`README.md`, `DATABASE.md`, `API_DOCUMENTATION.md`, `IMPLEMENTATION_PLAN.md`, `CHANGELOG.md`).

---

## Phase 3: Customer, Product & Van Management APIs

### Scope & Goals
- Add `Product` model to Prisma schema with pricing, stock quantities, and UK standard VAT rates.
- Apply migration `20261019064310_add_products_table` to MySQL `ledgerflow_db`.
- Build Van Management API with customer count aggregation and safe deletion protection (`409 Conflict`).
- Build Product Management API with search, category filtering, pagination, and soft deactivation default.
- Build Customer Management API with van routing validation, opening balance validation, pagination, search, safe deactivation (`status = 'Inactive'`), and linked user protection (`409 Conflict`).
- Enforce customer portal isolation: Customer role users can only access their assigned customer profile (`403 Forbidden`).
- Build comprehensive automated test suite and verify zero regression against Phase 2.

### Task Checklist
- [x] Added `Product` model and `idx_customers_status` index to `prisma/schema.prisma`.
- [x] Created and executed migration `20261019064310_add_products_table`.
- [x] Seeded initial produce catalog items in `prisma/seed.js`.
- [x] Implemented `src/controllers/van.controller.js` and `src/routes/van.routes.js`.
- [x] Implemented `src/controllers/product.controller.js` and `src/routes/product.routes.js`.
- [x] Implemented `src/controllers/customer.controller.js` and `src/routes/customer.routes.js`.
- [x] Mounted `/api/v1/vans`, `/api/v1/products`, and `/api/v1/customers` in `src/app.js`.
- [x] Built and executed Phase 3 automated test suite (`src/scripts/testPhase3.js`): **38/38 tests passed**.
- [x] Re-ran Phase 2 regression suite (`src/scripts/testPhase2.js`): **23/23 tests passed**.
- [x] Updated all documentation files (`DATABASE.md`, `API_DOCUMENTATION.md`, `IMPLEMENTATION_PLAN.md`, `CHANGELOG.md`, `README.md`).

---

## Phase 4: Invoicing & Payment Engine (ACID Transactions)

### Scope & Goals
- Add `Invoice`, `InvoiceItem`, `Payment`, `PaymentAllocation`, and `InvoiceSequence` models to Prisma schema.
- Apply migration `20261019070708_add_invoices_and_payments` to MySQL `ledgerflow_db`.
- Implement decimal-safe financial calculations and half-up rounding in `src/utils/money.js`.
- Implement atomic sequential number generators (`INV-2026-xxx`, `PAY-2026-xxx`) in `src/utils/sequence.js`.
- Build Invoice Management API (drafting, multi-item creation, safe updating, finalize, auditable voiding).
- Build Payment Management API with atomic allocations, overpayment prevention, unallocated credit, and idempotency protection.
- Build Customer Running Statement API incorporating opening balance exactly once: $\text{Balance} = \text{openingBalance} + \sum(\text{Invoices}) - \sum(\text{Payments})$.
- Add strict foreign key protections: prevent deleting customers or products with invoice history.
- Enforce customer account isolation on invoices, payments, and financial statements.
- Build comprehensive automated test suite and verify zero regression against Phases 1, 2, and 3.

### Task Checklist
- [x] Designed and applied migration `20261019070708_add_invoices_and_payments`.
- [x] Implemented `src/utils/money.js` and `src/utils/sequence.js`.
- [x] Implemented `src/controllers/invoice.controller.js` and `src/routes/invoice.routes.js`.
- [x] Implemented `src/controllers/payment.controller.js` and `src/routes/payment.routes.js`.
- [x] Implemented `getCustomerStatement` and updated `deleteCustomer` in `src/controllers/customer.controller.js`.
- [x] Protected products from deletion in `src/controllers/product.controller.js` when referenced in invoice items.
- [x] Mounted `/api/v1/invoices` and `/api/v1/payments` in `src/app.js`.
- [x] Built and executed Phase 4 automated test suite (`src/scripts/testPhase4.js`): **42/42 tests passed**.
- [x] Re-ran Phase 2 & 3 regression suites: **23/23 Phase 2 passed, 38/38 Phase 3 passed**.
- [x] Synchronized all documentation files (`DATABASE.md`, `API_DOCUMENTATION.md`, `IMPLEMENTATION_PLAN.md`, `CHANGELOG.md`, `README.md`).

---

## Phase 5: Daily Operations, Van Aggregation & Mileage (Completed & Verified)

### Scope & Goals
- Add `Order`, `OrderItem`, `Mileage`, and `VehicleExpense` models to Prisma schema.
- Apply migration `20261019073420_add_orders_and_mileage` to MySQL `ledgerflow_db`.
- Implement daily customer order management with multi-item line snapshots, quantity/unit validation, and documented lifecycle.
- Enforce customer ordering policy: strictly prevent customer self-service order creation (`403 Forbidden`). Customer role users can only list and view their own orders.
- Implement wholesale procurement aggregation endpoint: calculate required daily purchasing requirements grouped by product and target date, with van breakdowns (`van1`, `van2`, etc.) and prominent unassigned van order identification.
- Derive procurement demand dynamically from order items, preventing duplicate counting upon recalculations; exclude cancelled and draft orders.
- Implement vehicle mileage tracking with non-negative readings and odometer regression protection against previous vehicle entries (`allowCorrection: true` override).
- Support automated travel reimbursement calculations and posting approved trips to vehicle expense ledger (`POST /api/v1/mileage/:id/post-expense`).
- Implement vehicle operating expense tracking (fuel, maintenance, etc.) with auditable voiding (`POST /api/v1/mileage/expenses/:id/void`).
- Build comprehensive automated test suite and verify zero regression against Phases 2, 3, and 4.

### Task Checklist
- [x] Designed and applied migration `20261019073420_add_orders_and_mileage`.
- [x] Extended `src/utils/sequence.js` with `getNextOrderNumber`, `getNextMileageNumber`, and `getNextExpenseNumber`.
- [x] Implemented `src/controllers/order.controller.js` and `src/routes/order.routes.js`.
- [x] Implemented `src/controllers/mileage.controller.js` and `src/routes/mileage.routes.js`.
- [x] Mounted `/api/v1/orders` and `/api/v1/mileage` in `src/app.js`.
- [x] Built and executed Phase 5 automated test suite (`src/scripts/testPhase5.js`): **39/39 tests passed**.
- [x] Re-ran Phase 2, 3 & 4 regression suites:
  - Phase 2: **23/23 passed**
  - Phase 3: **38/38 passed**
  - Phase 4: **42/42 passed**
- [x] Synchronized all documentation files (`DATABASE.md`, `API_DOCUMENTATION.md`, `IMPLEMENTATION_PLAN.md`, `CHANGELOG.md`, `README.md`).


---

## Phase 6: Accounting, VAT & Reports (Planned)
- General Ledger transaction queries.
- HMRC MTD VAT Return calculations from actual invoices and purchases.
- CSV report generators for sales, payments, and receivables.

---

## Phase 7: Frontend Integration & Production Deployment (Planned)
- Connect React frontend to Express backend via Axios service layer.
- Preserve UI components, styling, and animations.
- Configure Netlify API proxy and production CORS headers.
