export type BillingPeriodStatus =
  | 'DRAFT'
  | 'CALCULATED'
  | 'REVIEW'
  | 'PUBLISHED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CLOSED';

export type PaymentStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

// Matches backend BillingPeriod Prisma model
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

// Derived helper — not from API
export function billingPeriodName(p: BillingPeriod): string {
  const monthName = new Date(p.periodYear, p.periodMonth - 1).toLocaleString('default', {
    month: 'long',
  });
  return `${monthName} ${p.periodYear}`;
}

// Matches backend MaintenanceBill Prisma model
export interface MaintenanceBill {
  id: string;
  societyId: string;
  billingPeriodId: string;
  flatId: string;
  flatCode: string;
  invoiceNumber: string;
  totalAmount: string;
  paidAmount: string;
  pendingAmount: string;
  isPaid: boolean;
  isPublished: boolean;
  dueDate: string;
  calculationSnapshot: Record<string, unknown>;
  lineItems?: BillLineItem[];
  createdAt: string;
}

export interface BillLineItem {
  id: string;
  componentName: string;
  componentType: string;
  description?: string;
  quantity?: string;
  rate?: string;
  amount: string;
  calculationNote?: string;
}

// Matches backend PaymentSubmission Prisma model (with joined relations from service layer)
export interface PaymentSubmission {
  id: string;
  societyId: string;
  flatId: string;
  userId: string;
  maintenanceBillId: string | null;
  billingPeriodId: string | null;
  amount: string;
  paymentDate: string;
  paymentMethod: 'BANK_TRANSFER' | 'UPI' | 'CASH' | 'CHEQUE' | 'NEFT' | 'RTGS' | 'IMPS' | 'OTHER';
  referenceNumber: string | null;
  utrNumber: string | null;
  bankName: string | null;
  chequeNumber: string | null;
  notes: string | null;
  status: PaymentStatus;
  reviewNotes: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  // Joined relations (present when fetched by admin list/detail endpoints)
  flat?: { id: string; flatCode: string };
  user?: { id: string; firstName: string; lastName: string };
  maintenanceBill?: { id: string; invoiceNumber: string } | null;
}

// Matches backend Account Prisma model
export interface Account {
  id: string;
  societyId: string;
  name: string;
  accountType: 'SAVINGS' | 'CURRENT' | 'FIXED_DEPOSIT' | 'CASH' | 'OTHER';
  bankName: string | null;
  accountNumberMasked: string | null;
  currentBalance: string;
  isActive: boolean;
  description: string | null;
}

// Matches backend Fund Prisma model
export interface Fund {
  id: string;
  societyId: string;
  name: string;
  description: string | null;
  currentBalance: string;
  isVisibleToResidents: boolean;
  isActive: boolean;
}
