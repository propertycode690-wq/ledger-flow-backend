/**
 * Granular Permission Matrix and Definitions for LedgerFlow ERP
 */

export const PERMISSIONS = {
  // Financial Reports
  REPORTS_VIEW: 'reports:view',
  REPORTS_VAT: 'reports:vat',
  REPORTS_PNL: 'reports:pnl',

  // Invoices
  INVOICES_VIEW: 'invoices:view',
  INVOICES_CREATE: 'invoices:create',
  INVOICES_EDIT: 'invoices:edit',
  INVOICES_FINALIZE: 'invoices:finalize',
  INVOICES_VOID: 'invoices:void',
  INVOICES_DELETE: 'invoices:delete',

  // Purchases
  PURCHASES_VIEW: 'purchases:view',
  PURCHASES_CREATE: 'purchases:create',
  PURCHASES_EDIT: 'purchases:edit',
  PURCHASES_DELETE: 'purchases:delete',

  // Customers
  CUSTOMERS_VIEW: 'customers:view',
  CUSTOMERS_CREATE: 'customers:create',
  CUSTOMERS_EDIT: 'customers:edit',
  CUSTOMERS_DELETE: 'customers:delete',

  // Payments
  PAYMENTS_VIEW: 'payments:view',
  PAYMENTS_CREATE: 'payments:create',
  PAYMENTS_DELETE: 'payments:delete',

  // Orders (Operations)
  ORDERS_VIEW: 'orders:view',
  ORDERS_CREATE: 'orders:create',
  ORDERS_EDIT: 'orders:edit',
  ORDERS_DELETE: 'orders:delete',

  // Vehicle Mileage & Fuel Expenses
  MILEAGE_VIEW: 'mileage:view',
  MILEAGE_CREATE: 'mileage:create',
  MILEAGE_DELETE: 'mileage:delete',

  // Administrative User Management
  USERS_MANAGE: 'users:manage',
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export const PERMISSION_CATALOG = [
  {
    category: 'Reports & Accounting',
    permissions: [
      { id: PERMISSIONS.REPORTS_VIEW, label: 'View Reports', description: 'Browse financial reports and aged debtors' },
      { id: PERMISSIONS.REPORTS_VAT, label: 'View VAT Reports', description: 'Access HMRC VAT return summaries and quarters' },
      { id: PERMISSIONS.REPORTS_PNL, label: 'View Profit & Loss', description: 'Access Income & Expenses and net profit metrics' },
    ],
  },
  {
    category: 'Invoicing',
    permissions: [
      { id: PERMISSIONS.INVOICES_VIEW, label: 'View Invoices', description: 'Search and read sales invoices' },
      { id: PERMISSIONS.INVOICES_CREATE, label: 'Create Invoices', description: 'Issue new invoices or duplicate existing ones' },
      { id: PERMISSIONS.INVOICES_EDIT, label: 'Edit Invoices', description: 'Modify draft invoices' },
      { id: PERMISSIONS.INVOICES_FINALIZE, label: 'Finalize & Issue Invoices', description: 'Lock draft invoices into Issued status' },
      { id: PERMISSIONS.INVOICES_VOID, label: 'Void Invoices', description: 'Cancel and void issued invoices' },
      { id: PERMISSIONS.INVOICES_DELETE, label: 'Delete Invoices', description: 'Permanently remove draft invoices' },
    ],
  },
  {
    category: 'Purchases & Suppliers',
    permissions: [
      { id: PERMISSIONS.PURCHASES_VIEW, label: 'View Purchases', description: 'View produce purchase bills and suppliers' },
      { id: PERMISSIONS.PURCHASES_CREATE, label: 'Create Purchases', description: 'Record new purchase bills and import previews' },
      { id: PERMISSIONS.PURCHASES_EDIT, label: 'Edit Purchases', description: 'Update purchase bill amounts and items' },
      { id: PERMISSIONS.PURCHASES_DELETE, label: 'Delete Purchases', description: 'Remove purchase bill records' },
    ],
  },
  {
    category: 'Customers',
    permissions: [
      { id: PERMISSIONS.CUSTOMERS_VIEW, label: 'View Customers', description: 'Access customer directory and statements' },
      { id: PERMISSIONS.CUSTOMERS_CREATE, label: 'Create Customers', description: 'Add new client customer profiles' },
      { id: PERMISSIONS.CUSTOMERS_EDIT, label: 'Edit Customers', description: 'Update customer address, terms, or contact info' },
      { id: PERMISSIONS.CUSTOMERS_DELETE, label: 'Delete Customers', description: 'Remove customer accounts' },
    ],
  },
  {
    category: 'Payments',
    permissions: [
      { id: PERMISSIONS.PAYMENTS_VIEW, label: 'View Payments', description: 'View transaction logs and payment receipts' },
      { id: PERMISSIONS.PAYMENTS_CREATE, label: 'Create Payments', description: 'Record invoice payments and settlements' },
      { id: PERMISSIONS.PAYMENTS_DELETE, label: 'Void Payments', description: 'Void or cancel recorded payments' },
    ],
  },
  {
    category: 'Daily Orders',
    permissions: [
      { id: PERMISSIONS.ORDERS_VIEW, label: 'View Orders', description: 'Browse customer orders and van aggregations' },
      { id: PERMISSIONS.ORDERS_CREATE, label: 'Create Orders', description: 'Place daily wholesale orders' },
      { id: PERMISSIONS.ORDERS_EDIT, label: 'Edit Orders', description: 'Modify orders or cancel pending orders' },
      { id: PERMISSIONS.ORDERS_DELETE, label: 'Delete Orders', description: 'Delete cancelled or draft orders' },
    ],
  },
  {
    category: 'Mileage & Vehicles',
    permissions: [
      { id: PERMISSIONS.MILEAGE_VIEW, label: 'View Mileage', description: 'View van mileage logs and vehicle expenses' },
      { id: PERMISSIONS.MILEAGE_CREATE, label: 'Log Mileage & Fuel', description: 'Record daily mileage logs and fuel receipts' },
      { id: PERMISSIONS.MILEAGE_DELETE, label: 'Delete Mileage & Expenses', description: 'Delete mileage trips or void expenses' },
    ],
  },
  {
    category: 'Administration',
    permissions: [
      { id: PERMISSIONS.USERS_MANAGE, label: 'Manage Users & Permissions', description: 'Create and edit users, assign roles and granular permissions' },
    ],
  },
];

export const DEFAULT_ROLE_PERMISSIONS = {
  admin: ALL_PERMISSIONS,
  accountant: [
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_VAT,
    PERMISSIONS.REPORTS_PNL,
  ],
  customer: [],
};

/**
 * Returns safe effective permissions for a user.
 * - Admin always has all permissions.
 * - Non-admin can never have 'users:manage'.
 * - Existing Accountant with null/empty permissions safely receives DEFAULT_ROLE_PERMISSIONS.accountant (Reports-only).
 */
export function getEffectivePermissions(user) {
  if (!user) return [];

  // Superuser Admin has all permissions
  if (user.role === 'admin') {
    return [...ALL_PERMISSIONS];
  }

  // Parse permissions if stored as JSON array or string
  let perms = user.permissions;
  if (typeof perms === 'string') {
    try {
      perms = JSON.parse(perms);
    } catch {
      perms = null;
    }
  }

  // If explicit permissions array is set and non-empty, use it
  if (Array.isArray(perms) && perms.length > 0) {
    // Sanitize: filter against valid catalog and prevent non-admin from having USERS_MANAGE
    return perms.filter(
      (p) => ALL_PERMISSIONS.includes(p) && p !== PERMISSIONS.USERS_MANAGE
    );
  }

  // Secure default fallback:
  // For accountants: reports-only!
  if (user.role === 'accountant') {
    return [...DEFAULT_ROLE_PERMISSIONS.accountant];
  }

  return [...(DEFAULT_ROLE_PERMISSIONS[user.role] || [])];
}

/**
 * Check if a user possesses a specific permission.
 */
export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (permission === PERMISSIONS.USERS_MANAGE && user.role !== 'admin') return false;

  const effective = getEffectivePermissions(user);
  return effective.includes(permission);
}
