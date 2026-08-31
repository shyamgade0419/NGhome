import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Safely coerce a value that may be a raw Prisma Decimal ({s,e,d} object,
 * produced when class-transformer calls instanceToPlain before JSON.stringify)
 * into a plain JS number.  Also handles strings, numbers, and null.
 */
export function parseDecimalLike(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isNaN(n) ? 0 : n;
  }
  // Prisma Decimal serialised by class-transformer → {s: sign, e: exponent, d: digits[]}
  if (typeof value === 'object' && value !== null && 'd' in value && 'e' in value) {
    try {
      const v = value as { s?: number; e: number; d: number[] };
      const sign = v.s === -1 ? -1 : 1;
      // Each element in d (beyond the first) is zero-padded to 7 digits
      const digits = v.d.map((n, i) => (i === 0 ? String(n) : String(n).padStart(7, '0'))).join('');
      const n = sign * parseFloat(digits) * Math.pow(10, v.e - digits.length + 1);
      return isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

export function formatCurrency(value: string | number | null | undefined | object): string {
  const num = parseDecimalLike(value);
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
