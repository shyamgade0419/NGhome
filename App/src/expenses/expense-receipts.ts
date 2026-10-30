/**
 * Receipts on an expense: the bill or the photo of it, kept as evidence for the person who approves
 * and for the accounts. Pure rules here; the storage and the database are in ExpensesService.
 */

import { ExpenseStatus } from '@prisma/client';

/** A bill is one or two photos, a few at most. The cap also bounds what one expense can put on the server. */
export const MAX_RECEIPTS_PER_EXPENSE = 6;

/** Receipts are photos or PDFs — a Word or Excel file is not a receipt, and the camera never makes one. */
const RECEIPT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

export function isReceiptType(mimeType: string): boolean {
  return RECEIPT_MIME_TYPES.has(mimeType);
}

/** A rejected expense is closed; any other can still collect proof (a paid one often does, after the fact). */
export function canAddReceipt(status: ExpenseStatus): boolean {
  return status !== ExpenseStatus.REJECTED;
}

/** Once paid, the receipts are part of the record the books were closed on. */
export function canRemoveReceipt(status: ExpenseStatus): boolean {
  return status !== ExpenseStatus.PAID;
}

/** What a client sees of a receipt — never the storage path. */
export const RECEIPT_SELECT = { id: true, fileName: true, mimeType: true, fileSize: true, createdAt: true } as const;
