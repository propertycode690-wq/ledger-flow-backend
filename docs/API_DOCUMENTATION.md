# LedgerFlow API Documentation

This document describes all REST API endpoints for the **LedgerFlow Invoice System** backend service.

---

## 1. Base URL & Protocol
- **Local Development URL:** `http://localhost:5000`
- **API Prefix:** `/api` and `/api/v1`
- **Default Port:** `5000` (Configurable via `PORT` in `.env`)
- **Content-Type:** `application/json`

---

## 2. Implemented Endpoints

### 2.1 Server Health & Diagnostics (Phase 1)

#### `GET /api/health`
- **Status:** **Implemented & Verified**
- **Auth:** Public
- **Description:** Basic server heartbeat, environment, and uptime.
- **Success (200 OK):**
  ```json
  {
    "status": "ok",
    "service": "ledgerflow-backend",
    "version": "1.0.0",
    "environment": "development",
    "uptimeSeconds": 142,
    "timestamp": "2026-10-19T06:38:00.695Z"
  }
  ```

#### `GET /api/db-health`
- **Status:** **Implemented & Verified**
- **Auth:** Public
- **Description:** Read-only MySQL `SELECT 1` ping.
- **Success (200 OK):**
  ```json
  {
    "status": "ok",
    "database": "connected",
    "provider": "mysql",
    "latencyMs": 1,
    "details": {
      "connected": 1,
      "database_name": "ledgerflow_db",
      "server_time": "2026-10-19T06:38:00.000Z"
    },
    "timestamp": "2026-10-19T06:38:00.712Z"
  }
  ```

---

### 2.2 Authentication & User Session (Phase 2)

#### `POST /api/v1/auth/login`
- **Status:** **Implemented & Verified**
- **Auth:** Public
- **Description:** Authenticate user credentials, set HTTP-Only cookie, and issue JWT.
- **Request Body:**
  ```json
  {
    "email": "admin@freshharvest.co.uk",
    "password": "Password123!"
  }
  ```
- **Success (200 OK):**
  *Headers:* `Set-Cookie: token=<jwt>; Path=/; HttpOnly; SameSite=Lax`
  ```json
  {
    "status": "ok",
    "message": "Login successful.",
    "user": {
      "id": "USR-ADMIN",
      "email": "admin@freshharvest.co.uk",
      "name": "Fresh Harvest Admin",
      "role": "admin",
      "title": "Business Owner / Admin",
      "customerId": null,
      "customer": null,
      "lastLoginAt": "2026-10-19T06:38:01.388Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
- **Customer Success Example:**
  ```json
  {
    "status": "ok",
    "message": "Login successful.",
    "user": {
      "id": "USR-CUST-001",
      "email": "accounts@greenvalley.co.uk",
      "name": "David Miller",
      "role": "customer",
      "title": "Customer Client",
      "customerId": "CUST-001",
      "customer": {
        "id": "CUST-001",
        "name": "Green Valley Restaurant",
        "contactPerson": "David Miller",
        "email": "accounts@greenvalley.co.uk",
        "vanId": "van1",
        "status": "Active"
      },
      "lastLoginAt": "2026-10-19T06:38:02.234Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
- **Error Responses:**
  - `400 Bad Request` (`VALIDATION_ERROR`): Malformed email or empty password.
  - `401 Unauthorized` (`INVALID_CREDENTIALS`): Invalid email or password (safe, prevents user enumeration).
  - `403 Forbidden` (`ACCOUNT_DEACTIVATED`): Inactive user account.

#### `GET /api/v1/auth/me`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (Cookie `token` or Header `Authorization: Bearer <token>`)
- **Description:** Retrieve currently authenticated user profile.
- **Success (200 OK):**
  ```json
  {
    "status": "ok",
    "user": {
      "id": "USR-ADMIN",
      "email": "admin@freshharvest.co.uk",
      "name": "Fresh Harvest Admin",
      "role": "admin",
      "title": "Business Owner / Admin",
      "customerId": null,
      "customer": null,
      "lastLoginAt": "2026-10-19T06:38:01.711Z"
    }
  }
  ```
- **Error Responses:**
  - `401 Unauthorized` (`UNAUTHORIZED` / `INVALID_TOKEN`): Missing or invalid token.

#### `POST /api/v1/auth/logout`
- **Status:** **Implemented & Verified**
- **Auth:** Protected
- **Description:** Clears the HTTP-only cookie and ends session.
- **Success (200 OK):**
  *Headers:* `Set-Cookie: token=; Max-Age=0; Path=/; HttpOnly`
  ```json
  {
    "status": "ok",
    "message": "Logged out successfully."
  }
  ```

---

### 2.3 Vans Management (Phase 3)

#### `GET /api/v1/vans`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Retrieve all vans with assigned customer count.
- **Success (200 OK):**
  ```json
  {
    "status": "ok",
    "data": [
      {
        "id": "van1",
        "name": "Van 1 - North Route",
        "driverName": "John Driver",
        "routeArea": "North London",
        "plateNumber": "LD68 ABC",
        "status": "Active",
        "customerCount": 2,
        "createdAt": "2026-10-19T06:38:00.000Z",
        "updatedAt": "2026-10-19T06:38:00.000Z"
      }
    ]
  }
  ```

#### `POST /api/v1/vans`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin` only)
- **Request Body:**
  ```json
  {
    "name": "Van 4 - West Route",
    "driverName": "David Smith",
    "routeArea": "West London",
    "plateNumber": "W12 ABC",
    "status": "Active"
  }
  ```
- **Success (201 Created):** Returns created van object.
- **Errors:** `400 Bad Request` (`VALIDATION_ERROR`).

#### `GET /api/v1/vans/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Retrieve van details with list of assigned customers.
- **Success (200 OK):**
  ```json
  {
    "status": "ok",
    "data": {
      "id": "van1",
      "name": "Van 1 - North Route",
      "customers": [
        {
          "id": "CUST-001",
          "name": "Green Valley Restaurant",
          "contactPerson": "David Miller",
          "status": "Active"
        }
      ]
    }
  }
  ```
- **Errors:** `404 Not Found` (`VAN_NOT_FOUND`).

#### `PUT /api/v1/vans/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin` only)
- **Request Body:** Any subset of `name`, `driverName`, `routeArea`, `plateNumber`, `status`.
- **Success (200 OK):** Returns updated van object.

#### `DELETE /api/v1/vans/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin` only)
- **Description:** Deletes van if no customers are assigned.
- **Success (200 OK):**
  ```json
  {
    "status": "ok",
    "message": "Van deleted successfully."
  }
  ```
- **Errors:** `409 Conflict` (`VAN_HAS_ASSIGNED_CUSTOMERS`) if customers are still bound to this van.

---

### 2.4 Products Catalog & Management (Phase 3)

#### `GET /api/v1/products`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (Any authenticated user: `admin`, `accountant`, `customer`)
- **Query Parameters:**
  - `page` (default `1`)
  - `limit` (default `50`, max `200`)
  - `search` (matches `name` or `code`)
  - `category` (exact filter)
  - `status` (`Active` or `Inactive`)
- **Success (200 OK):**
  ```json
  {
    "status": "ok",
    "data": [
      {
        "id": "PROD-001",
        "name": "Organic Roma Tomatoes",
        "code": "TOM-ROM",
        "category": "Produce",
        "unit": "kg",
        "price": 3.49,
        "vatRate": 0.0,
        "isActive": true
      }
    ],
    "pagination": {
      "total": 12,
      "page": 1,
      "limit": 50,
      "totalPages": 1
    }
  }
  ```

#### `POST /api/v1/products`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Request Body:**
  ```json
  {
    "name": "Fresh Organic Avocados",
    "code": "AVO-001",
    "category": "Produce",
    "unit": "box",
    "price": 14.99,
    "costPrice": 9.50,
    "vatRate": 0,
    "stockQty": 50,
    "minStockAlert": 10,
    "isActive": true
  }
  ```
- **Success (201 Created):** Returns created product object.
- **Errors:** `400 Bad Request` (`VALIDATION_ERROR`), `409 Conflict` (`PRODUCT_CODE_EXISTS`).

#### `GET /api/v1/products/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`, `customer`)
- **Success (200 OK):** Returns single product object.
- **Errors:** `404 Not Found` (`PRODUCT_NOT_FOUND`).

#### `PUT /api/v1/products/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Request Body:** Partial product fields.
- **Success (200 OK):** Returns updated product object.

#### `DELETE /api/v1/products/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Query Parameters:** `?hard=true` (optional, defaults to soft deactivation `isActive: false`).
- **Success (200 OK):**
  ```json
  {
    "status": "ok",
    "message": "Product deactivated successfully."
  }
  ```

---

### 2.5 Customers Management (Phase 3)

#### `GET /api/v1/customers`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Isolation Policy:** Customer role accounts cannot access this endpoint (`403 Forbidden`).
- **Query Parameters:**
  - `page` (default `1`)
  - `limit` (default `25`, max `100`)
  - `search` (matches `name`, `contactPerson`, `email`, `phone`, `city`, `taxNumber`)
  - `vanId` (filter by van)
  - `status` (`Active` or `Inactive`)
- **Success (200 OK):**
  ```json
  {
    "status": "ok",
    "data": [
      {
        "id": "CUST-001",
        "name": "Green Valley Restaurant",
        "contactPerson": "David Miller",
        "email": "accounts@greenvalley.co.uk",
        "phone": "+44 20 7946 0912",
        "openingBalance": 450.00,
        "paymentTerms": 30,
        "status": "Active",
        "vanId": "van1",
        "van": {
          "id": "van1",
          "name": "Van 1 - North Route"
        }
      }
    ],
    "pagination": {
      "total": 3,
      "page": 1,
      "limit": 25,
      "totalPages": 1
    }
  }
  ```

#### `POST /api/v1/customers`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Request Body:**
  ```json
  {
    "name": "Golden Gate Cafe",
    "contactPerson": "Alice Smith",
    "email": "alice@goldengate.co.uk",
    "phone": "+44 20 7946 0999",
    "address": "45 Market St",
    "city": "London",
    "postalCode": "W1 4AB",
    "taxNumber": "GB998877665",
    "paymentTerms": 30,
    "openingBalance": 250.00,
    "vanId": "van1",
    "status": "Active"
  }
  ```
- **Validation Rules:**
  - `name`: Min 2 chars (required)
  - `email`: Valid email format (optional)
  - `vanId`: If provided, verified against existing van IDs in database (`400 INVALID_VAN_ID` if not found).
  - `openingBalance`: Positive or zero decimal (cannot be negative).
- **Success (201 Created):** Returns created customer object.

#### `GET /api/v1/customers/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`, or `customer` viewing own profile).
- **Isolation Policy:** If a `customer` user accesses `:id` other than their own assigned `customerId`, returns `403 Forbidden` (`CUSTOMER_ISOLATION_VIOLATION`).
- **Success (200 OK):** Returns customer record with assigned van details.
- **Errors:** `404 Not Found` (`CUSTOMER_NOT_FOUND`).

#### `PUT /api/v1/customers/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Request Body:** Partial customer fields. Validates `vanId` exists if changed.
- **Success (200 OK):** Returns updated customer record.

#### `GET /api/v1/customers/:id/statement`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`, or matching `customer`)
- **Isolation Policy:** If a `customer` user accesses `:id` other than their own assigned `customerId`, returns `403 Forbidden` (`CUSTOMER_ISOLATION_VIOLATION`).
- **Description:** Generates an official running financial statement. Incorporates customer's opening balance exactly once, tracking all active invoices and completed payments chronologically.
- **Success (200 OK):**
  ```json
  {
    "status": "ok",
    "data": {
      "customer": {
        "id": "CUST-001",
        "name": "Green Valley Restaurant"
      },
      "summary": {
        "openingBalance": 2360.50,
        "totalInvoiced": 188.00,
        "totalPaid": 88.00,
        "currentOutstandingBalance": 2460.50
      },
      "transactions": [
        {
          "type": "OPENING_BALANCE",
          "debit": 0,
          "credit": 0,
          "balance": 2360.50
        },
        {
          "type": "INVOICE",
          "reference": "INV-2026-090",
          "debit": 188.00,
          "credit": 0,
          "balance": 2548.50
        },
        {
          "type": "PAYMENT",
          "reference": "PAY-2026-001",
          "debit": 0,
          "credit": 88.00,
          "balance": 2460.50
        }
      ]
    }
  }
  ```

---

### 2.6 Invoices Management Engine (Phase 4)

#### `GET /api/v1/invoices`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (Admin, Accountant, Customer)
- **Isolation Policy:** Customer role users can strictly see invoices belonging to their account (`where customerId = req.user.customerId`). Drafts are hidden from customer portal.
- **Query Parameters:** `page`, `limit`, `search`, `status`, `customerId`, `startDate`, `endDate`, `sortBy`, `sortOrder`.
- **Success (200 OK):** Returns paginated list of invoices.

#### `GET /api/v1/invoices/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (Admin, Accountant, Customer)
- **Isolation Policy:** Customer role blocked with `403 CUSTOMER_ISOLATION_VIOLATION` if accessing another customer's invoice.
- **Success (200 OK):** Returns detailed invoice object with line items and payment allocations.

#### `POST /api/v1/invoices`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Creates an invoice inside an interactive database transaction. Concurrency-safely issues sequential numbers (`INV-2026-xxx`) and calculates line subtotals, UK VAT, and balances server-side.
- **Request Body:**
  ```json
  {
    "customerId": "CUST-001",
    "issueDate": "2026-10-19",
    "dueDate": "2026-11-02",
    "reference": "PO-8841",
    "status": "Sent",
    "discountAmount": 0,
    "items": [
      { "productId": "PROD-001", "description": "Vine Tomatoes", "quantity": 40, "unit": "kg", "unitPrice": 3.20, "vatRate": 0 },
      { "description": "Olive Oil 5L", "quantity": 2, "unit": "tins", "unitPrice": 25.00, "vatRate": 20 }
    ]
  }
  ```
- **Success (201 Created):** Returns created invoice record.

#### `PUT /api/v1/invoices/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Updates a draft invoice.
- **Financial Safety Rule:** Editing finalized, sent, or paid invoices is rejected with `409 Conflict` (`CANNOT_EDIT_FINALIZED_INVOICE`).

#### `POST /api/v1/invoices/:id/finalize`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Promotes a Draft invoice to Sent and activates its balance due.

#### `POST /api/v1/invoices/:id/void`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Safely cancels/voids an invoice with an auditable reason. Reverses any allocated payments and restores them as on-account customer credit.
- **Request Body:** `{ "reason": "Order cancelled by customer before delivery." }`

#### `DELETE /api/v1/invoices/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin` only)
- **Description:** Only draft invoices with zero payment allocations can be hard deleted. Issued or finalized invoices must be cancelled using the void API (`409 CANNOT_DELETE_FINALIZED_INVOICE`).

---

### 2.7 Payments & Allocations Engine (Phase 4)

#### `GET /api/v1/payments`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (Admin, Accountant, Customer)
- **Isolation Policy:** Customer users can only view their own payment remittances.
- **Query Parameters:** `page`, `limit`, `customerId`, `startDate`, `endDate`, `search`, `status`.

#### `GET /api/v1/payments/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (Admin, Accountant, Customer)
- **Success (200 OK):** Returns payment details with linked invoice allocations.

#### `POST /api/v1/payments`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Records a customer payment atomically. Supports idempotency keys (`idempotencyKey`) preventing duplicate charges. Allocates payment across eligible invoices, updates invoice amounts and statuses (`Paid`, `Partially Paid`), and retains unallocated remainder as on-account credit.
- **Request Body:**
  ```json
  {
    "customerId": "CUST-001",
    "amount": 188.00,
    "paymentDate": "2026-10-19",
    "paymentMethod": "Bank Transfer",
    "reference": "BACS-8841",
    "idempotencyKey": "IDEMP-99881",
    "allocations": [
      { "invoiceId": "cmvex5j9s0001tov8rdpk13aj", "amount": 188.00 }
    ]
  }
  ```
- **Financial Safety Rules:**
  - Overpayment exceeding invoice balance is strictly rejected with `400 OVERPAYMENT_NOT_ALLOWED`.
  - Mismatched customer invoices rejected with `400 INVOICE_CUSTOMER_MISMATCH`.
  - Paying draft or void invoices rejected with `400 INVALID_INVOICE_STATUS`.
- **Success (201 Created):** Returns created payment.

#### `POST /api/v1/payments/:id/void`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Atomically reverses a payment. Restores invoice balances and reverts status from `Paid` to `Sent` or `Partially Paid`.
- **Request Body:** `{ "reason": "Bounced bank transfer." }`

---

### 2.8 Daily Customer Orders & Procurement Demand (Phase 5)

#### `GET /api/v1/orders`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (Admin, Accountant, Customer)
- **Isolation Policy:** Customer role is strictly isolated to viewing orders belonging to their linked account (`req.user.customerId`).
- **Query Parameters:**
  - `page`, `limit` (pagination)
  - `date`, `startDate`, `endDate` (filter by delivery target date)
  - `customerId` (filter by customer; customer role cannot view other accounts)
  - `vanId` (filter by delivery van or `unassigned`)
  - `status` (`Confirmed`, `Draft`, `Invoiced`, `Cancelled`)
  - `search` (searches order numbers, customer name, notes, item names)

#### `GET /api/v1/orders/procurement/aggregation`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Dynamically calculates wholesale wholesale purchasing requirements for a target delivery date by aggregating product demand across active customer orders (`Confirmed`, `Invoiced`).
- **Query Parameters:**
  - `date` (YYYY-MM-DD, defaults to current date)
  - `vanId` (optional van filter or `unassigned`)
- **Procurement Rules:**
  - Cancelled orders contribute 0 demand and are strictly excluded.
  - Draft orders are excluded from wholesale purchasing commitments.
  - Groups items by product snapshot name and packaging unit.
  - Provides per-product van distribution breakdowns (`van1`, `van2`, etc.) and prominently flags `unassigned` van orders.
  - Avoids double counting upon recalculation by dynamically deriving demand from underlying order items.
- **Success (200 OK):**
  ```json
  {
    "status": "success",
    "data": {
      "date": "2026-10-25",
      "filterVanId": "all",
      "totalOrders": 3,
      "ordersByStatus": { "Confirmed": 3 },
      "unassignedOrdersCount": 1,
      "unassignedOrderNumbers": ["ORD-2026-10-25-03"],
      "totalProducts": 4,
      "procurementList": [
        {
          "productId": "PROD-001",
          "name": "Vine Tomatoes",
          "unit": "kg",
          "totalQuantity": 48.00,
          "vanBreakdown": { "van1": 18.00, "van2": 20.00, "unassigned": 10.00 },
          "customerBreakdown": [...]
        }
      ]
    }
  }
  ```

#### `GET /api/v1/orders/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (Admin, Accountant, Customer)
- **Isolation Policy:** Customer users can only view their own orders (`403 CUSTOMER_ISOLATION_VIOLATION`).
- **Description:** Retrieves detailed order with line items, units, quantities, customer details, and van assignment.

#### `POST /api/v1/orders`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Customer Policy:** Customer self-service ordering is strictly prohibited (`403 SELF_SERVICE_ORDERING_NOT_PERMITTED`). Orders must be entered by staff.
- **Description:** Creates a daily customer order with atomic sequential number (`ORD-YYYY-MM-DD-xx`), snapshots product names, units, and rates.
- **Request Body:**
  ```json
  {
    "customerId": "CUST-001",
    "vanId": "van1",
    "orderDate": "2026-10-25",
    "status": "Confirmed",
    "notes": "Morning priority delivery",
    "items": [
      { "productId": "PROD-001", "name": "Vine Tomatoes", "quantity": 18, "unit": "kg", "unitPrice": 2.80 },
      { "productId": "PROD-002", "name": "King Edward Potatoes", "quantity": 30, "unit": "kg", "unitPrice": 1.20 }
    ]
  }
  ```

#### `PUT /api/v1/orders/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Updates order details and line items.
- **Lifecycle Constraints:**
  - Cancelled orders cannot be modified (`400 ORDER_LIFECYCLE_VIOLATION`).
  - Invoiced orders cannot be modified (`400 ORDER_LIFECYCLE_VIOLATION`).

#### `POST /api/v1/orders/:id/cancel`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Cancels an order according to lifecycle rules. Sets `status = 'Cancelled'` and appends audit reason to notes.
- **Lifecycle Constraints:**
  - Already cancelled orders return `400 ORDER_ALREADY_CANCELLED`.
  - Invoiced orders cannot be cancelled (`400 ORDER_ALREADY_INVOICED`).

#### `DELETE /api/v1/orders/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin` only)
- **Description:** Safe deletion. Only Draft or Cancelled orders may be permanently deleted. Active `Confirmed` or `Invoiced` orders cannot be deleted (`400 ACTIVE_ORDER_DELETION_FORBIDDEN`).

---

### 2.9 Vehicle Mileage & Operating Expenses (Phase 5)

#### `GET /api/v1/mileage`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Query Parameters:** `page`, `limit`, `vanId`, `startDate`, `endDate`, `recordedInExpenses`, `search`.

#### `GET /api/v1/mileage/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Retrieves mileage trip details with linked vehicle expenses.

#### `POST /api/v1/mileage`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Records a vehicle journey with non-negative readings and automated distance / reimbursement calculation.
- **Odometer Safety Rules:**
  - Rejects negative readings (`400 NEGATIVE_MILEAGE_READING`).
  - Rejects `endMileage <= startMileage` (`400 INVALID_ODOMETER_RANGE`).
  - Rejects impossible odometer regression (`startMileage < previousLatestReading`) unless explicit `allowCorrection: true` is authorized (`400 ODOMETER_REGRESSION_DETECTED`).
- **Request Body:**
  ```json
  {
    "vanId": "van1",
    "date": "2026-10-25",
    "startMileage": 42150,
    "endMileage": 42200,
    "distanceUnit": "miles",
    "purpose": "Morning Spitalfields market wholesale collection",
    "rate": 0.45,
    "allowCorrection": false
  }
  ```

#### `PUT /api/v1/mileage/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Updates mileage readings. If already posted to expenses, automatically reconciles linked active vehicle expense records.

#### `DELETE /api/v1/mileage/:id`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin` only)
- **Description:** Safely deletes mileage trip and atomically cleans up any linked ledger claims.

#### `POST /api/v1/mileage/:id/post-expense`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Converts an approved mileage trip into an itemized `VehicleExpense` record in the expense ledger (`Category: 'Vehicle & Travel'`).
- **Safety Rule:** Rejects duplicate claims (`400 ALREADY_RECORDED_IN_EXPENSES`).

#### `GET /api/v1/mileage/expenses`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Lists vehicle and operating expenses with category, van, and date filters.

#### `POST /api/v1/mileage/expenses`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Records manual vehicle operating expense (Fuel, Maintenance, Tolls, Insurance, etc.).

#### `POST /api/v1/mileage/expenses/:id/void`
- **Status:** **Implemented & Verified**
- **Auth:** Protected (`admin`, `accountant`)
- **Description:** Safely voids an expense with an audit reason (`status = 'Void'`), preserving financial history. If created from a mileage claim, releases the mileage entry for correction or re-posting.

---

## 3. Server-Side RBAC & Security Enforcements

The backend enforces role access in middleware, completely independent of the React frontend:

1. **`requireAuth`**: Validates JWT and attaches active database user to `req.user`.
2. **`requireRole(['admin', 'accountant'])`**: Rejects unauthorized access with `403 Forbidden` if `req.user.role` does not match.
3. **`enforceCustomerScope`**: Strictly prevents customer users from supplying or accessing another customer's ID (`403 CUSTOMER_ISOLATION_VIOLATION`).

---

## 4. Planned Endpoints (Phase 6 & Later — Not Implemented)

### General Ledger & Accounting (Phase 6)
- `GET /api/v1/transactions` — *Not Implemented*
- `POST /api/v1/transactions` — *Not Implemented*
- `GET /api/v1/accounting/vat-summary` — *Not Implemented*

### Settings (Phase 6)
- `GET /api/v1/settings` — *Not Implemented*
- `PUT /api/v1/settings` — *Not Implemented*



