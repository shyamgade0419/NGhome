import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
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

export function initials(name: string): string {
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
