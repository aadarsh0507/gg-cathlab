export type Screen =
  | 'items'
  | 'invoices'
  | 'users'
  | 'roles'
  | 'categories'
  | 'units'
  | 'vendors'
  | 'vendor_documents'
  | 'approval_levels'
  | 'reports'
  | 'audit_log';

export const SCREEN_LABELS: Record<Screen, string> = {
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

export const SCREEN_LIST: Screen[] = [
  'items',
  'invoices',
  'users',
  'roles',
  'categories',
  'units',
  'vendors',
  'vendor_documents',
  'approval_levels',
  'reports',
  'audit_log',
];

export interface ScreenPermission {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export type PermissionMatrix = Partial<Record<Screen, ScreenPermission>>;

export interface Role {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean | number;
  created_at?: string;
  updated_at?: string;
  permissions: PermissionMatrix;
}

export interface User {
  id: number;
  username: string;
  full_name: string;
  role_id: number;
  role_name: string;
  permissions?: PermissionMatrix;
  is_active: boolean | number;
  created_at?: string;
  updated_at?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Patient {
  uhid: string;
  name: string;
  age: number | null;
  gender: string | null;
  mobile: string | null;
  address: string | null;
  doctor: string | null;
  department: string | null;
  bed: string | null;
  nurseStation: string | null;
  admissionDate: string | null;
  dischargeRequestDate: string | null;
  dischargeEntryTime: string | null;
  dischargeBilledTime: string | null;
}

export interface Item {
  id: number;
  item_code: string;
  item_name: string;
  short_name: string | null;
  category_id: number | null;
  category_name: string | null;
  purchase_cost: number | null;
  mrp: number;
  unit_id: number | null;
  unit_name: string | null;
  is_active: boolean | number;
  created_at?: string;
  updated_at?: string;
}

export interface MasterOption {
  id: number;
  name: string;
  is_active: boolean | number;
  created_at?: string;
}

export interface InvoiceLineInput {
  item_id: number | null;
  item_name: string;
  batch_no: string | null;
  expiry_date: string | null;
  quantity: number;
  mrp: number;
}

export interface InvoiceListItem {
  id: number;
  invoice_no: string;
  patient_uhid: string;
  patient_name: string;
  invoice_date: string;
  total_amount: number;
  status: string;
  approval_status: ApprovalStatus;
  created_at: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalLevel {
  id: number;
  name: string;
  sequence_order: number;
  is_active: boolean | number;
  created_at?: string;
  approvers: { id: number; full_name: string; username: string }[];
}

export interface InvoiceApproval {
  id: number;
  invoice_id: number;
  approval_level_id: number;
  level_name: string;
  sequence_order: number;
  status: ApprovalStatus;
  acted_by: number | null;
  acted_by_name: string | null;
  acted_at: string | null;
  remarks: string | null;
}

export type PaymentMode = 'Credit' | 'Cash' | 'Card' | 'UPI' | 'Insurance' | 'Cheque';

export interface InvoiceDetail {
  id: number;
  invoice_no: string;
  patient_uhid: string;
  patient_name: string;
  patient_age: string | null;
  patient_gender: string | null;
  patient_mobile: string | null;
  patient_address: string | null;
  doctor_name: string | null;
  department: string | null;
  payment_mode: PaymentMode;
  invoice_date: string;
  bill_date: string | null;
  subtotal: number;
  discount_percent: number;
  discount_amount: number;
  total_amount: number;
  status: string;
  created_at: string;
  created_by_name: string | null;
  approval_status: ApprovalStatus;
  items: InvoiceLineDetail[];
  vendor_documents: VendorDocument[];
  approvals: InvoiceApproval[];
}

export interface VendorDocument {
  id: number;
  invoice_id: number;
  vendor_id: number;
  vendor_name: string;
  vendor_invoice_no: string | null;
  vendor_invoice_date: string | null;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  file_size: number;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

export interface VendorDocumentReportRow {
  document_id: number;
  invoice_id: number;
  patient_uhid: string;
  patient_name: string;
  invoice_no: string;
  invoice_date: string;
  vendor_id: number;
  vendor_name: string;
  vendor_invoice_no: string | null;
  vendor_invoice_date: string | null;
  original_filename: string;
  uploaded_at: string;
  uploaded_by_name: string | null;
}

export interface InvoiceLineDetail {
  id: number;
  item_id: number | null;
  item_name: string;
  batch_no: string | null;
  expiry_date: string | null;
  quantity: number;
  mrp: number;
  line_total: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AuditLogFieldChange {
  from: unknown;
  to: unknown;
}

export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  username: string;
  screen: Screen;
  action: 'create' | 'update' | 'delete';
  record_id: string | null;
  details: Record<string, AuditLogFieldChange> | null;
  created_at: string;
}
