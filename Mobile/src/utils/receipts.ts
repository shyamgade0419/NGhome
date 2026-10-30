/**
 * Receipts on an expense — a photo of the bill from the camera, or a photo or PDF from the phone.
 * Pure rules and wording; the camera and the file picker are in components/expenses/receiptCapture.
 * The limits mirror the server's (App/src/expenses/expense-receipts.ts), which is what enforces them.
 */

export const MAX_RECEIPTS = 6;
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export type ExpenseStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';

/** A receipt waiting to be sent: where it is on the phone, and what to call it. */
export interface Receipt {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

/** A receipt already on the server. */
export interface StoredReceipt {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "expense-receipt-20261030-1721.jpg" — the camera's own names (IMG_2031) say nothing to the accounts. */
export function receiptName(now: Date, extension = 'jpg'): string {
  const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `expense-receipt-${day}-${time}.${extension}`;
}

const EXTENSION_FOR_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/** A photo just taken: given a readable name, and a type the server will accept. */
export function fromCamera(asset: { uri: string; mimeType?: string | null; fileSize?: number | null }, now: Date): Receipt {
  const mimeType = asset.mimeType && EXTENSION_FOR_TYPE[asset.mimeType] ? asset.mimeType : 'image/jpeg';
  return { uri: asset.uri, name: receiptName(now, EXTENSION_FOR_TYPE[mimeType]), mimeType, size: asset.fileSize ?? undefined };
}

/** A file chosen from the phone. Some pickers leave the type out; a name ending .pdf or .jpg says enough. */
export function fromPicker(asset: { uri: string; name: string; mimeType?: string | null; size?: number | null }): Receipt {
  const lower = asset.name.toLowerCase();
  const guessed = lower.endsWith('.pdf')
    ? 'application/pdf'
    : lower.endsWith('.png') ? 'image/png'
    : lower.endsWith('.webp') ? 'image/webp'
    : lower.endsWith('.heic') ? 'image/heic'
    : 'image/jpeg';
  return { uri: asset.uri, name: asset.name, mimeType: asset.mimeType || guessed, size: asset.size ?? undefined };
}

export const isPdf = (mimeType: string) => mimeType === 'application/pdf';
const isReceiptType = (mimeType: string) => mimeType === 'application/pdf' || mimeType.startsWith('image/');

/** Why this receipt cannot be added, or null when it can. `already` counts those already chosen or stored. */
export function receiptProblem(receipt: Receipt, already: number): string | null {
  if (already >= MAX_RECEIPTS) return `An expense can have at most ${MAX_RECEIPTS} receipts.`;
  if (!isReceiptType(receipt.mimeType)) return 'A receipt must be a photo or a PDF.';
  if (receipt.size !== undefined && receipt.size > MAX_RECEIPT_BYTES) return 'That file is over 10 MB — take the photo again, or pick a smaller one.';
  return null;
}

export function receiptCountLabel(count: number): string {
  return count === 0 ? 'No receipts' : count === 1 ? '1 receipt' : `${count} receipts`;
}

/** A rejected expense is closed. */
export const canAddReceiptTo = (status: ExpenseStatus) => status !== 'REJECTED';
/** A paid expense keeps its receipts — they are part of the record the books were closed on. */
export const canRemoveReceiptFrom = (status: ExpenseStatus) => status !== 'PAID';
