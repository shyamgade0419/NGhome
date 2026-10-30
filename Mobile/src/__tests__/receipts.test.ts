import {
  MAX_RECEIPTS, MAX_RECEIPT_BYTES, canAddReceiptTo, canRemoveReceiptFrom, fromCamera, fromPicker,
  receiptCountLabel, receiptName, receiptProblem,
} from '@/utils/receipts';

const receipt = (over: Partial<{ mimeType: string; size: number }> = {}) => ({ uri: 'file:///a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', ...over });

describe('receipt names', () => {
  it('names a camera photo by when it was taken, not by the camera\'s own IMG_2031', () => {
    expect(receiptName(new Date(2026, 9, 30, 17, 21, 5))).toBe('expense-receipt-20261030-172105.jpg');
    expect(receiptName(new Date(2026, 0, 2, 3, 4, 5), 'png')).toBe('expense-receipt-20260102-030405.png');
  });

  it('keeps a photo\'s own type when the server accepts it, and falls back to JPEG when the camera does not say', () => {
    const now = new Date(2026, 9, 30, 9, 0, 0);
    expect(fromCamera({ uri: 'u', mimeType: 'image/png' }, now)).toMatchObject({ mimeType: 'image/png', name: 'expense-receipt-20261030-090000.png' });
    expect(fromCamera({ uri: 'u', mimeType: null }, now)).toMatchObject({ mimeType: 'image/jpeg', name: 'expense-receipt-20261030-090000.jpg' });
    expect(fromCamera({ uri: 'u', mimeType: 'video/mp4' }, now).mimeType).toBe('image/jpeg');
  });

  it('works out the type of a picked file whose picker left it blank', () => {
    expect(fromPicker({ uri: 'u', name: 'Bill.PDF', mimeType: null }).mimeType).toBe('application/pdf');
    expect(fromPicker({ uri: 'u', name: 'bill.png', mimeType: undefined }).mimeType).toBe('image/png');
    expect(fromPicker({ uri: 'u', name: 'bill', mimeType: null }).mimeType).toBe('image/jpeg');
    expect(fromPicker({ uri: 'u', name: 'x.pdf', mimeType: 'application/pdf', size: 1234 })).toMatchObject({ mimeType: 'application/pdf', size: 1234 });
  });
});

describe('receiptProblem', () => {
  it('accepts a photo or a PDF', () => {
    expect(receiptProblem(receipt(), 0)).toBeNull();
    expect(receiptProblem(receipt({ mimeType: 'application/pdf' }), 3)).toBeNull();
  });

  it('refuses the one past the limit, and says how many are allowed', () => {
    expect(receiptProblem(receipt(), MAX_RECEIPTS - 1)).toBeNull();
    expect(receiptProblem(receipt(), MAX_RECEIPTS)).toContain(String(MAX_RECEIPTS));
  });

  it('refuses anything that is not a photo or a PDF', () => {
    expect(receiptProblem(receipt({ mimeType: 'text/csv' }), 0)).toMatch(/photo or a PDF/);
    expect(receiptProblem(receipt({ mimeType: 'application/msword' }), 0)).toMatch(/photo or a PDF/);
  });

  it('refuses a file over the size the server takes, and allows exactly that size', () => {
    expect(receiptProblem(receipt({ size: MAX_RECEIPT_BYTES }), 0)).toBeNull();
    expect(receiptProblem(receipt({ size: MAX_RECEIPT_BYTES + 1 }), 0)).toMatch(/10 MB/);
  });
});

describe('receipt wording and rules', () => {
  it('counts in words', () => {
    expect(receiptCountLabel(0)).toBe('No receipts');
    expect(receiptCountLabel(1)).toBe('1 receipt');
    expect(receiptCountLabel(4)).toBe('4 receipts');
  });

  it('matches the server: add until rejected, remove until paid', () => {
    expect(canAddReceiptTo('PENDING')).toBe(true);
    expect(canAddReceiptTo('APPROVED')).toBe(true);
    expect(canAddReceiptTo('PAID')).toBe(true);
    expect(canAddReceiptTo('REJECTED')).toBe(false);
    expect(canRemoveReceiptFrom('PENDING')).toBe(true);
    expect(canRemoveReceiptFrom('REJECTED')).toBe(true);
    expect(canRemoveReceiptFrom('PAID')).toBe(false);
  });
});
