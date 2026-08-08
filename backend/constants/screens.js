// Fixed registry of app screens/resources for the RBAC permission matrix.
// This is a code-level concept, not admin-editable data: each key maps to a
// group of API routes. Adding a new screen means adding a route group, so the
// list only changes when the app itself grows a new resource.
const SCREENS = {
  ITEMS: 'items',
  INVOICES: 'invoices',
  USERS: 'users',
  ROLES: 'roles',
  CATEGORIES: 'categories',
  UNITS: 'units',
  VENDORS: 'vendors',
  VENDOR_DOCUMENTS: 'vendor_documents',
  APPROVAL_LEVELS: 'approval_levels',
  REPORTS: 'reports',
  AUDIT_LOG: 'audit_log',
};

const SCREEN_LIST = Object.values(SCREENS);

const SCREEN_LABELS = {
  items: 'Item Master',
  invoices: 'Invoices',
  users: 'Users',
  roles: 'Roles',
  categories: 'Categories',
  units: 'Units',
  vendors: 'Vendors',
  vendor_documents: 'Vendor Documents',
  approval_levels: 'Approval Levels',
  reports: 'Reports',
  audit_log: 'Audit Log',
};

module.exports = { SCREENS, SCREEN_LIST, SCREEN_LABELS };
