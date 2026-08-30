import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: string | number | null | undefined | { toString(): string }): string {
  if (value === null || value === undefined) return '₹0';
  // Guard against Prisma Decimal objects ({s,e,d}) that lack toJSON() on some backends.
  const raw = typeof value === 'number' ? value : parseFloat(String(value));
  const num = Number.isNaN(raw) ? 0 : raw;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatDate(iso: string, fmt = 'dd MMM yyyy'): string {
  try {
    return format(parseISO(iso), fmt);
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  return formatDate(iso, 'dd MMM yyyy, h:mm a');
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function roleLabel(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const PAYMENT_METHODS: Record<string, string> = {
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank Transfer',
  CHEQUE: 'Cheque',
  CASH: 'Cash',
  NEFT: 'NEFT',
  RTGS: 'RTGS',
  OTHER: 'Other',
};

export const EXPENSE_CATEGORIES = [
  'MAINTENANCE',
  'UTILITIES',
  'SECURITY',
  'HOUSEKEEPING',
  'REPAIRS',
  'LANDSCAPING',
  'ADMINISTRATIVE',
  'EVENTS',
  'OTHER',
];
