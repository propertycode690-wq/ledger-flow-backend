# LedgerFlow Backend Service

> **Backend API for LedgerFlow Invoice System**  
> Built with Node.js, Express.js, Prisma ORM, and MySQL (XAMPP).

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js:** v18.0.0+ (Tested on v24.x)
- **XAMPP for Windows:** With Apache and MySQL installed.
- **MySQL Database:** Ensure `ledgerflow_db` exists in MySQL.

### 2. Verify XAMPP MySQL
1. Open **XAMPP Control Panel**.
2. Click **Start** on **MySQL** (Port 3306).
3. If not already created, create the database:
   ```sql
   CREATE DATABASE IF NOT EXISTS ledgerflow_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

### 3. Setup Environment Variables
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Verify your configuration in `.env`:
   ```env
   DATABASE_URL="mysql://root:@localhost:3306/ledgerflow_db"
   PORT=5000
   NODE_ENV=development
   FRONTEND_URL="http://localhost:5173"
   JWT_SECRET="your-256-bit-secret-key-here"
   JWT_EXPIRES_IN="7d"
   ```

### 4. Install Dependencies & Apply Migrations
```bash
npm install
npm run prisma:generate
npm run seed
```

### 5. Start the Server
- **Development Mode (Auto-restart on change):**
  ```bash
  npm run dev
  ```
- **Production Mode:**
  ```bash
  npm start
  ```
- **Run Phase 2 Security & Authentication Tests:**
  ```bash
  npm run test:phase2
  ```
- **Run Phase 3 Customer, Product & Van Tests:**
  ```bash
  npm run test:phase3
  ```
- **Run Phase 4 Invoice & Payment Engine Tests:**
  ```bash
  npm run test:phase4
  ```
- **Run Phase 5 Daily Operations & Mileage Tests:**
  ```bash
  npm run test:phase5
  ```

---

## 🩺 Implemented Endpoints (Phases 1, 2, 3, 4 & 5)

Once the server is running on `http://localhost:5000`:

### Core & Authentication
| Endpoint | Method | Auth / Roles | Description |
|---|---|---|---|
| `/api/health` | `GET` | Public | Server status & uptime heartbeat |
| `/api/db-health` | `GET` | Public | Read-only MySQL `SELECT 1` ping |
| `/api/v1/auth/login` | `POST` | Public | Authenticates credentials, sets HTTP-only cookie, returns JWT |
| `/api/v1/auth/me` | `GET` | Protected (All) | Returns active authenticated user session profile |
| `/api/v1/auth/logout` | `POST` | Protected (All) | Clears authentication cookie and ends session |

### Daily Customer Orders & Procurement Demand
| Endpoint | Method | Auth / Roles | Description |
|---|---|---|---|
| `/api/v1/orders` | `GET` | All (Customer-scoped) | List daily customer orders with date, customer, van, and status filters |
| `/api/v1/orders/procurement/aggregation` | `GET` | `admin`, `accountant` | Calculate daily wholesale procurement requirements with van breakdowns |
| `/api/v1/orders` | `POST` | `admin`, `accountant` | Create daily order with multi-product lines; generates sequential order number |
| `/api/v1/orders/:id` | `GET` | All (Customer-scoped) | Retrieve order details with line item snapshots |
| `/api/v1/orders/:id` | `PUT` | `admin`, `accountant` | Update order details/items (blocked for cancelled/invoiced orders) |
| `/api/v1/orders/:id/cancel` | `POST` | `admin`, `accountant` | Cancel order with documented lifecycle rules |
| `/api/v1/orders/:id` | `DELETE` | `admin` | Safe deletion of draft or cancelled orders |

### Vehicle Mileage & Operating Expenses
| Endpoint | Method | Auth / Roles | Description |
|---|---|---|---|
| `/api/v1/mileage` | `GET` | `admin`, `accountant` | List vehicle trips with van, date range, and pagination |
| `/api/v1/mileage` | `POST` | `admin`, `accountant` | Record mileage with odometer regression validation (`allowCorrection` flag) |
| `/api/v1/mileage/:id` | `GET` | `admin`, `accountant` | Retrieve mileage record with linked expenses |
| `/api/v1/mileage/:id` | `PUT` | `admin`, `accountant` | Update mileage readings; reconciles linked active expenses |
| `/api/v1/mileage/:id/post-expense` | `POST` | `admin`, `accountant` | Post trip claim to vehicle expenses ledger; prevents double claims |
| `/api/v1/mileage/:id` | `DELETE` | `admin` | Safely remove mileage record and reconcile linked ledger records |
| `/api/v1/mileage/expenses` | `GET` | `admin`, `accountant` | List vehicle expenses with category and date filters |
| `/api/v1/mileage/expenses` | `POST` | `admin`, `accountant` | Record vehicle operating expense (Fuel, Maintenance, Tolls, etc.) |
| `/api/v1/mileage/expenses/:id/void` | `POST` | `admin`, `accountant` | Safely void expense with documented audit reason |

### Invoices Management Engine
| Endpoint | Method | Auth / Roles | Description |
|---|---|---|---|
| `/api/v1/invoices` | `GET` | All (Customer-scoped) | List invoices with pagination, search, status, and date filters |
| `/api/v1/invoices` | `POST` | `admin`, `accountant` | Create invoice with atomic sequential numbering & VAT calculation |
| `/api/v1/invoices/:id` | `GET` | All (Customer-scoped) | Get detailed invoice with line items & allocations |
| `/api/v1/invoices/:id` | `PUT` | `admin`, `accountant` | Safely update draft invoice (finalized invoices are immutable) |
| `/api/v1/invoices/:id/finalize` | `POST` | `admin`, `accountant` | Finalize draft invoice into an active issued record |
| `/api/v1/invoices/:id/void` | `POST` | `admin`, `accountant` | Auditable invoice voiding; safely reverses payment allocations |
| `/api/v1/invoices/:id` | `DELETE` | `admin` | Delete draft invoice (finalized invoices must be voided) |

### Payments & Allocations Engine
| Endpoint | Method | Auth / Roles | Description |
|---|---|---|---|
| `/api/v1/payments` | `GET` | All (Customer-scoped) | List payments with pagination, customer and date filters |
| `/api/v1/payments` | `POST` | `admin`, `accountant` | Record payment with atomic invoice allocations & idempotency |
| `/api/v1/payments/:id` | `GET` | All (Customer-scoped) | Get payment details with linked invoice allocations |
| `/api/v1/payments/:id/void` | `POST` | `admin`, `accountant` | Atomically void payment and restore invoice balances |

### Customers Directory & Accounts
| Endpoint | Method | Auth / Roles | Description |
|---|---|---|---|
| `/api/v1/customers` | `GET` | `admin`, `accountant` | List customers with search, van filter, pagination |
| `/api/v1/customers` | `POST` | `admin`, `accountant` | Create customer with van and opening balance validation |
| `/api/v1/customers/:id` | `GET` | `admin`, `accountant`, `customer` (self) | Get customer details (strictly isolated for customer role) |
| `/api/v1/customers/:id/statement` | `GET` | `admin`, `accountant`, `customer` (self) | Live customer running statement with opening balance |
| `/api/v1/customers/:id` | `PUT` | `admin`, `accountant` | Update customer record |
| `/api/v1/customers/:id` | `DELETE` | `admin` | Safe deactivate (`status = 'Inactive'`); blocks hard delete on linked users or financial records |

### Products Catalog
| Endpoint | Method | Auth / Roles | Description |
|---|---|---|---|
| `/api/v1/products` | `GET` | All authenticated | List products with pagination, search, category filter |
| `/api/v1/products` | `POST` | `admin`, `accountant` | Create product (unique SKU/code) |
| `/api/v1/products/:id` | `GET` | All authenticated | Get single product |
| `/api/v1/products/:id` | `PUT` | `admin`, `accountant` | Update product details |
| `/api/v1/products/:id` | `DELETE` | `admin`, `accountant` | Soft deactivate (`isActive: false`); blocks hard delete if in invoice items |

### Vans Management
| Endpoint | Method | Auth / Roles | Description |
|---|---|---|---|
| `/api/v1/vans` | `GET` | `admin`, `accountant` | List all vans with active customer count |
| `/api/v1/vans` | `POST` | `admin` | Create new van |
| `/api/v1/vans/:id` | `GET` | `admin`, `accountant` | Get van details with assigned customers |
| `/api/v1/vans/:id` | `PUT` | `admin` | Update van details |
| `/api/v1/vans/:id` | `DELETE` | `admin` | Safe delete van (blocked if customers assigned) |

---

## 🔑 Default Seeded Accounts (Development)

The seed script (`npm run seed`) populates the verified system user accounts with 12-round salted bcrypt hashes:

| Role | Email | Password | Access Level | Bound Customer |
|---|---|---|---|---|
| **Admin** | `admin@freshharvest.co.uk` | `Password123!` | Full System & Management | `NULL` |
| **Accountant** | `accounts@freshharvest.co.uk` | `Password123!` | Financial Ledgers & VAT | `NULL` |
| **Customer** | `accounts@greenvalley.co.uk` | `Password123!` | Customer Portal Only | `CUST-001` (Green Valley) |

---

## 📂 Project Directory Structure

```
backend/
├── docs/
│   ├── API_DOCUMENTATION.md    # Implemented & planned endpoint contracts
│   ├── DATABASE.md             # XAMPP MySQL setup & schema definitions
│   └── IMPLEMENTATION_PLAN.md  # Multi-phase project roadmap
├── prisma/
│   ├── migrations/             # Safe, versioned SQL migrations
│   ├── schema.prisma           # Prisma MySQL schema definition
│   └── seed.js                 # Database seeder (users, vans, customers, products)
├── src/
│   ├── config/
│   │   └── db.js               # Prisma client & connection check helper
│   ├── controllers/
│   │   ├── auth.controller.js     # login, me, logout handlers
│   │   ├── customer.controller.js # Customer CRUD, statements & isolation
│   │   ├── invoice.controller.js  # Invoice lifecycle & decimal totals
│   │   ├── mileage.controller.js  # Mileage, odometer checks & vehicle expenses
│   │   ├── order.controller.js    # Daily orders & procurement aggregation
│   │   ├── payment.controller.js  # Payment allocations & idempotency
│   │   ├── product.controller.js  # Product catalog handlers
│   │   └── van.controller.js      # Van fleet handlers
│   ├── middlewares/
│   │   ├── auth.middleware.js     # requireAuth, requireRole, enforceCustomerScope
│   │   └── validate.middleware.js # Zod request validation middleware
│   ├── routes/
│   │   ├── auth.routes.js         # /api/v1/auth route declarations
│   │   ├── customer.routes.js     # /api/v1/customers route declarations
│   │   ├── health.routes.js       # /api/health and /api/db-health handlers
│   │   ├── invoice.routes.js      # /api/v1/invoices route declarations
│   │   ├── mileage.routes.js      # /api/v1/mileage route declarations
│   │   ├── order.routes.js        # /api/v1/orders route declarations
│   │   ├── payment.routes.js      # /api/v1/payments route declarations
│   │   ├── product.routes.js      # /api/v1/products route declarations
│   │   └── van.routes.js          # /api/v1/vans route declarations
│   ├── scripts/
│   │   ├── testPhase2.js          # 23-assertion Phase 2 security test suite
│   │   ├── testPhase3.js          # 38-assertion Phase 3 CRUD & isolation test suite
│   │   ├── testPhase4.js          # 42-assertion Phase 4 invoice & payment test suite
│   │   └── testPhase5.js          # 39-assertion Phase 5 daily orders & mileage suite
│   ├── utils/
│   │   ├── money.js               # Decimal-safe arithmetic & rounding
│   │   ├── sequence.js            # Atomic sequential number generation
│   │   └── token.js               # JWT signing, verification, and cookie options
│   ├── app.js                     # Express middleware, CORS, routes mounting
│   └── server.js                  # Server entry point & startup diagnostics
├── .env.example                   # Sanitized environment variable template
├── .gitignore                     # Git ignore rules (.env, node_modules)
├── CHANGELOG.md                   # Record of project updates
├── package.json                   # Dependencies & scripts
└── README.md                      # Setup guide (this file)
```

---

## ⚙️ NPM Scripts

- `npm run dev` — Starts the server with Node native `--watch` flag.
- `npm start` — Starts the server in standard production mode.
- `npm run prisma:generate` — Regenerates `@prisma/client` bindings.
- `npm run prisma:studio` — Opens the visual Prisma database browser.
- `npm run seed` — Populates baseline vans, customers, settings, users, and product catalog.
- `npm run test:phase2` — Executes the 23-point Phase 2 test suite.
- `npm run test:phase3` — Executes the 38-point Phase 3 customer, product & van test suite.
- `npm run test:phase4` — Executes the 42-point Phase 4 invoice & payment engine test suite.
- `npm run test:phase5` — Executes the 39-point Phase 5 daily orders & mileage test suite.

---

## 🔧 Troubleshooting

### 1. `Can't connect to MySQL server on 'localhost:3306'`
- **Cause:** MySQL service is stopped in XAMPP.
- **Solution:** Open XAMPP Control Panel and ensure MySQL status is green on Port 3306.

### 2. `Access denied for user 'root'@'localhost'`
- **Cause:** Your XAMPP MySQL root user has a password set.
- **Solution:** Update `.env` with the password: `DATABASE_URL="mysql://root:YOUR_PASSWORD@localhost:3306/ledgerflow_db"`.
