# Changelog

All notable changes to the LedgerFlow Backend service will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.5.0-frontend-auth] - 2026-10-19

### Added
- **Centralized Frontend API Client (`frontend/src/services/api.js`):**
  - Integrated universal fetch wrapper configured with `credentials: 'include'` for automated session cookie transmission.
  - Base URL driven by `VITE_API_BASE_URL` with fallback to `http://localhost:5000`.
  - Added `authApi` methods: `login({ email, password })`, `getMe()`, `logout()`, `health()`.
  - Created `frontend/.env` and `frontend/.env.example` templates.
  - Added Vite proxy in `frontend/vite.config.js` forwarding `/api` to backend port 5000 in development.
- **Frontend Authentication Flow (`frontend/src/pages/auth/Login.jsx` & `frontend/src/context/AppContext.jsx`):**
  - Replaced mock authentication and local role bypass with real `POST /api/v1/auth/login`.
  - Handled server-issued HTTP-only session cookies without storing JWTs or passwords in `localStorage`.
  - Configured session restoration on startup via `GET /api/v1/auth/me`.
  - Removed default admin user fallback (`defaultAdminUser`) and fake client role selectors.
  - Updated `logoutUser()` to call `POST /api/v1/auth/logout` and clear client session state.
  - Updated `RoleGuard` and `AppLayout` to block unauthenticated access and enforce server-provided roles (`admin`, `accountant`, `customer`).
  - Added inline server error messaging banner on the Login form.

---

## [1.4.0-phase5] - 2026-10-19

### Added
- **Database & Schema:**
  - Designed and executed migration `20261019073420_add_orders_and_mileage`.
  - Added models: `Order`, `OrderItem`, `Mileage`, `VehicleExpense`.
  - Configured foreign keys and cascade rules (`Order.items` cascade, `Customer.orders` restrict, `Product.orderItems` restrict, `Van.orders` set null, `Van.mileages` set null, `Mileage.expenses` set null).
- **Sequential Number Generators (`src/utils/sequence.js`):**
  - Added `getNextOrderNumber` (`ORD-YYYY-MM-DD-xx`).
  - Added `getNextMileageNumber` (`MIL-YYYY-xxx`).
  - Added `getNextExpenseNumber` (`EXP-YYYY-xxx`).
- **Daily Customer Orders API (`/api/v1/orders`):**
  - `GET /api/v1/orders`: Paginated list with date, customer, van, and status filters; enforces customer role isolation.
  - `GET /api/v1/orders/:id`: Detailed order retrieval with line items and snapshots.
  - `POST /api/v1/orders`: Multi-item daily order creation; strictly prohibits customer self-service order placement (`403 Forbidden: SELF_SERVICE_ORDERING_NOT_PERMITTED`). Admin/accountant entry verified.
  - `PUT /api/v1/orders/:id`: Updates order details/lines; blocks modifications on cancelled or invoiced orders (`400 ORDER_LIFECYCLE_VIOLATION`).
  - `POST /api/v1/orders/:id/cancel`: Lifecycle cancellation recording optional reason in notes.
  - `DELETE /api/v1/orders/:id`: Safe deletion restricted to draft or cancelled orders (active orders cannot be deleted).
- **Wholesale Van Procurement Demand Aggregation (`/api/v1/orders/procurement/aggregation`):**
  - Aggregates daily produce demand by product and target delivery date across active orders (`Confirmed`, `Invoiced`).
  - Provides per-product van distribution breakdown (`van1`, `van2`, etc.) and explicitly identifies unassigned-van orders.
  - Excludes cancelled orders (0 contribution) and draft orders.
  - Derives demand dynamically from order items, preventing duplicate counts upon recalculation.
- **Vehicle Mileage Tracking API (`/api/v1/mileage`):**
  - `GET /api/v1/mileage`: Paginated journey history with van, date, and expense-posting status filters.
  - `GET /api/v1/mileage/:id`: Trip detail with linked vehicle expenses.
  - `POST /api/v1/mileage`: Journey logging with odometer validation (`endMileage > startMileage`, non-negative) and automated reimbursement calculation (`distance * rate`).
  - **Odometer Regression Protection:** Rejects start mileage lower than the vehicle's last recorded odometer reading unless explicit `allowCorrection: true` is authorized.
  - `PUT /api/v1/mileage/:id`: Updates readings and automatically reconciles linked expense claims.
  - `DELETE /api/v1/mileage/:id`: Safely cleans up mileage and linked expenses in an atomic transaction.
  - `POST /api/v1/mileage/:id/post-expense`: Posts approved trip claim to vehicle operating expense ledger; rejects duplicate postings.
- **Vehicle Operating Expenses API (`/api/v1/mileage/expenses`):**
  - `GET /api/v1/mileage/expenses`: Paginated expense ledger with category and van filters.
  - `POST /api/v1/mileage/expenses`: Itemized vehicle expense logging (Fuel, Maintenance, Tolls, Insurance, etc.).
  - `POST /api/v1/mileage/expenses/:id/void`: Safely voids expense with audit reason, preserving financial history, and releases any linked mileage record.
- **Automated Verification:**
  - Added `src/scripts/testPhase5.js` with 39 automated assertions covering CRUD, validation, permissions, customer isolation, aggregation, odometer regression, and void audit trails.
  - Verified 100% pass rate: **39 passed, 0 failed**.
  - Re-verified zero regression on Phases 2, 3, and 4:
    - Phase 2: **23/23 passed**
    - Phase 3: **38/38 passed**
    - Phase 4: **42/42 passed**
  - **Grand Total: 142/142 tests passing across all completed phases.**

---

## [1.3.0-phase4] - 2026-10-19

### Added
- **Database & Schema:**
  - Designed and executed migration `20261019070708_add_invoices_and_payments`.
  - Added models: `Invoice`, `InvoiceItem`, `Payment`, `PaymentAllocation`, `InvoiceSequence`.
  - Configured foreign key restrictions (`Customer.invoices`, `Customer.payments`, `Product.invoiceItems`).
- **Financial Mathematics & Concurrency Engine:**
  - Created `src/utils/money.js` enforcing half-up arithmetic rounding (`round2`), decimal-safe line calculations, and invoice total summaries.
  - Created `src/utils/sequence.js` implementing atomic, transaction-safe sequential number generators (`INV-YYYY-xxx` and `PAY-YYYY-xxx`).
- **Invoices API (`/api/v1/invoices`):**
  - `GET /api/v1/invoices`: Paginated invoice list with search, status, customer, and date range filters (customer-scoped).
  - `GET /api/v1/invoices/:id`: Detailed invoice view with line items, historical price snapshots, and allocations.
  - `POST /api/v1/invoices`: Atomic transaction creation with server-side VAT and total calculations.
  - `PUT /api/v1/invoices/:id`: Safe draft update; strictly rejects editing finalized/issued invoices (`409 Conflict`).
  - `POST /api/v1/invoices/:id/finalize`: Promotes draft to issued/sent status and activates customer balance due.
  - `POST /api/v1/invoices/:id/void`: Auditable voiding mechanism recording cancellation reason and safely reversing payment allocations.
  - `DELETE /api/v1/invoices/:id`: Permitted only on draft invoices with 0 payments; finalized invoices must be voided.
- **Payments API (`/api/v1/payments`):**
  - `POST /api/v1/payments`: Records remittances with idempotency protection (`idempotencyKey`). Atomically adjusts target invoice balances and statuses (`Paid`, `Partially Paid`), and retains unallocated remainder as on-account credit.
  - `GET /api/v1/payments`: Paginated payment list.
  - `GET /api/v1/payments/:id`: Payment details with allocation breakdown.
  - `POST /api/v1/payments/:id/void`: Atomic payment reversal restoring invoice balances and previous statuses.
- **Customer Statement API (`/api/v1/customers/:id/statement`):**
  - Live running financial ledger combining opening balance (incorporated exactly once) with active invoices and payments.
- **Relational Integrity Enforcement:**
  - Extended customer deletion guard to block deleting customers with invoice or payment history (`409 Conflict: CUSTOMER_HAS_FINANCIAL_RECORDS`).
  - Extended product deletion guard to block deleting products referenced in invoice items (`409 Conflict: PRODUCT_HAS_INVOICE_RECORDS`).
- **Automated Verification:**
  - Added `src/scripts/testPhase4.js` covering 42 assertions.
  - Verified 100% pass rate: **42 passed, 0 failed**.
  - Re-ran Phase 2 & 3 suites: **23/23 Phase 2 passed, 38/38 Phase 3 passed**.

---

## [1.2.0-phase3] - 2026-10-19

### Added
- **Database & Schema:**
  - Added `Product` model to `prisma/schema.prisma` with SKU/code uniqueness, category, unit, unit price, cost price, UK VAT rates, stock quantities, and active status flag.
  - Added composite index `idx_customers_status` on `customers(status)` for high-performance directory filtering.
  - Executed migration `20261019064310_add_products_table`.
  - Updated `prisma/seed.js` with 12 baseline produce catalog items across Produce, Dairy, and Bakery categories.
- **Vans Management API (`/api/v1/vans`):**
  - `GET /api/v1/vans`: List all vans with assigned active customer counts (`customerCount`).
  - `POST /api/v1/vans`: Create van record with Zod validation (admin only).
  - `GET /api/v1/vans/:id`: Retrieve single van with attached customers list.
  - `PUT /api/v1/vans/:id`: Update van metadata (admin only).
  - `DELETE /api/v1/vans/:id`: Safe van deletion preventing deletion if customers are assigned (`409 Conflict: VAN_HAS_ASSIGNED_CUSTOMERS`).
- **Products Catalog API (`/api/v1/products`):**
  - `GET /api/v1/products`: Search by name/code, category filter, active status filter, and pagination (accessible by admin, accountant, customer).
  - `POST /api/v1/products`: Create product with code uniqueness enforcement (`409 Conflict: PRODUCT_CODE_EXISTS`).
  - `GET /api/v1/products/:id`: Retrieve product details.
  - `PUT /api/v1/products/:id`: Update product fields with code collision checks.
  - `DELETE /api/v1/products/:id`: Soft deactivation default (`isActive: false`) with optional permanent purge (`?hard=true`).
- **Customers Management API (`/api/v1/customers`):**
  - `GET /api/v1/customers`: Paginated customer directory with search, van filter, status filter, and eager loading of van info (admin and accountant only).
  - `POST /api/v1/customers`: Create customer with non-negative opening balance validation and verified `vanId` foreign key checks (`400 INVALID_VAN_ID`).
  - `GET /api/v1/customers/:id`: Customer detail endpoint with strict client isolation. Customer role accounts can only access their own profile (`403 Forbidden: CUSTOMER_ISOLATION_VIOLATION`).
  - `PUT /api/v1/customers/:id`: Update customer details with van verification.
  - `DELETE /api/v1/customers/:id`: Safe deactivation default (`status: 'Inactive'`). Hard delete (`?hard=true`) checks for linked users (`409 Conflict: CUSTOMER_HAS_LINKED_USERS`).
- **Automated Verification:**
  - Added `src/scripts/testPhase3.js` testing 38 assertions across CRUD, Zod validation, role authorization, foreign key constraints, safe deactivations, and customer isolation.
  - Verified 100% pass rate: **38 passed, 0 failed**.
  - Verified zero regression on Phase 2 test suite: **23 passed, 0 failed**.

---

## [1.1.0-phase2] - 2026-10-19

### Added
- **Core MySQL Schema:**
  - Designed and executed migration `20261019063216_init_phase2_auth_core`.
  - Added tables: `vans`, `customers`, `users`, `business_settings`.
  - Configured foreign key constraints (`customers.van_id -> vans.id`, `users.customer_id -> customers.id`) and indexes.
- **Authentication System:**
  - Added `POST /api/v1/auth/login` with Zod input validation, salted bcrypt verification, and JWT generation.
  - Added `GET /api/v1/auth/me` returning sanitized active user profile.
  - Added `POST /api/v1/auth/logout` invalidating active HTTP-Only cookies.
  - Configured `cookie-parser` in Express pipeline.
- **Server-Side Security & RBAC:**
  - Built `requireAuth` middleware supporting both HTTP-Only cookies and Bearer headers.
  - Built `requireRole(['admin', 'accountant', 'customer'])` middleware enforcing server-side permission checks.
  - Built `enforceCustomerScope` middleware preventing customer users from accessing or modifying other client accounts.
  - Omitted sensitive credentials (`passwordHash`) from all JSON responses.
- **Seeding & Testing:**
  - Added `prisma/seed.js` for verified baseline accounts with 12-round bcrypt hashes.
  - Added automated test suite `src/scripts/testPhase2.js` covering 23 security, validation, RBAC, and isolation test cases.

---

## [1.0.0-phase1] - 2026-10-19

### Added
- **Project Scaffold:** Initialized Node.js backend workspace in `backend/` using ES modules.
- **Core Dependencies:** Installed `express`, `cors`, `dotenv`, `@prisma/client`, and `prisma`.
- **Database Configuration:** Configured `prisma/schema.prisma` targeting MySQL on XAMPP.
- **Health Checks:** Implemented `GET /api/health` and `GET /api/db-health`.
