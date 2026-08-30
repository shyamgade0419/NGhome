export type Role =
  | 'PLATFORM_ADMIN'
  | 'SOCIETY_ADMIN'
  | 'SOCIETY_ACCOUNTANT'
  | 'SOCIETY_STAFF'
  | 'COMMITTEE_MEMBER'
  | 'RESIDENT';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  phone?: string | null;
  currentRole?: Role;
  societyId?: string;
  isPlatformAdmin: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface SocietyMembership {
  id: string;
  societyId: string;
  societyName: string;
  societyLogo: string | null;
  role: Role;
  flatId: string | null;
  flatNumber: string | null;
  buildingName: string | null;
  status: string;
}

export interface Society {
  id: string;
  name: string;
  displayName: string | null;
  city: string | null;
  state: string | null;
}

// Composite: built from /reports/collection-summary, /reports/account-balances, /societies/my/stats
export interface DashboardSummary {
  totalBilled: string;
  totalCollected: string;
  totalOutstanding: string;
  totalExpenses: string;
  accountBalance: string;
  corpusBalance: string;
  pendingApprovals: number;
  buildings: number;
  flats: number;
  members: number;
}

// Matches backend BillingPeriod Prisma model
export type BillingPeriodStatus =
  | 'DRAFT'
  | 'CALCULATED'
  | 'REVIEW'
  | 'PUBLISHED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CLOSED';

export interface BillingPeriod {
  id: string;
  societyId: string;
  periodYear: number;
  periodMonth: number;
  startDate: string;
  endDate: string;
  dueDate: string;
  status: BillingPeriodStatus;
  totalBilled: string;
  totalCollected: string;
  totalPending: string;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

export function billingPeriodLabel(p: BillingPeriod): string {
  return new Date(p.periodYear, p.periodMonth - 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });
}

// Matches backend MaintenanceBill Prisma model (with flat join from service)
export interface MaintenanceBill {
  id: string;
  societyId: string;
  billingPeriodId: string;
  flatId: string;
  invoiceNumber: string;
  flatCode: string;
  totalAmount: string;
  baseAmount: string;
  paidAmount: string;
  pendingAmount: string;
  /** Water charges allocated to this flat for the period. */
  waterCharges?: string | null;
  isPaid: boolean;
  isPublished: boolean;
  dueDate: string;
  createdAt: string;
  flat?: { id: string; flatCode: string };
  /** Populated by billing service when a primary resident has a phone number. */
  residentPhone?: string | null;
  /** Primary resident's display name — populated alongside residentPhone. */
  residentName?: string | null;
}

// Matches backend PaymentSubmission Prisma model (with joins from service)
export type PaymentStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export interface Payment {
  id: string;
  societyId: string;
  flatId: string;
  userId: string;
  amount: string;
  paymentDate: string;
  paymentMethod: 'BANK_TRANSFER' | 'UPI' | 'CASH' | 'CHEQUE' | 'NEFT' | 'RTGS' | 'IMPS' | 'OTHER';
  referenceNumber: string | null;
  utrNumber: string | null;
  notes: string | null;
  status: PaymentStatus;
  reviewNotes: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  // Joined relations
  flat?: { id: string; flatCode: string };
  user?: { id: string; firstName: string; lastName: string };
  maintenanceBill?: { id: string; invoiceNumber: string } | null;
}

// Matches backend Expense Prisma model
export type ExpenseStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';

export interface Expense {
  id: string;
  societyId: string;
  categoryId: string | null;
  vendorPayee: string | null;
  description: string;
  amount: string;
  expenseDate: string;
  invoiceNumber: string | null;
  referenceNumber: string | null;
  status: ExpenseStatus;
  notes: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  category?: { name: string } | null;
}

// Matches backend Announcement Prisma model
export type AnnouncementPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface Announcement {
  id: string;
  societyId: string;
  title: string;
  content: string;
  priority: AnnouncementPriority;
  audience: string;
  publishAt: string | null;
  expiresAt: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
}

// Shape returned by the web client interceptor for paginated endpoints
export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ApiError {
  message: string;
  statusCode: number;
  error?: string;
}
