import { previewReminder, validPaymentDate, whatsappUrl } from '@/utils/reminders';

describe('whatsappUrl', () => {
  it('opens the chat with the number, putting 91 in front of a bare Indian number', () => {
    expect(whatsappUrl('Hi', '98765 43210')).toBe('https://wa.me/919876543210?text=Hi');
    expect(whatsappUrl('Hi', '+91 98765-43210')).toBe('https://wa.me/919876543210?text=Hi');
  });

  it('keeps a number that already carries its country code', () => {
    expect(whatsappUrl('Hi', '919876543210')).toBe('https://wa.me/919876543210?text=Hi');
  });

  it('opens WhatsApp for the admin to pick the contact when there is no number', () => {
    expect(whatsappUrl('Hi', null)).toBe('https://wa.me/?text=Hi');
    expect(whatsappUrl('Hi', '   ')).toBe('https://wa.me/?text=Hi');
  });

  it('encodes the message, line breaks and rupee sign included', () => {
    expect(whatsappUrl('Pay ₹500\nnow', '9876543210')).toBe('https://wa.me/919876543210?text=Pay%20%E2%82%B9500%0Anow');
  });
});

describe('previewReminder', () => {
  it('fills the known details and leaves a mistyped one visible', () => {
    expect(previewReminder('Dear {name}, flat {flat} owes ₹{amount} {oops}')).toBe('Dear Asha Rao, flat A-101 owes ₹3,500 {oops}');
  });
});

describe('validPaymentDate', () => {
  const today = new Date('2026-10-05T10:00:00Z');
  it('accepts today and earlier days', () => {
    expect(validPaymentDate('2026-10-05', today)).toBe(true);
    expect(validPaymentDate('2026-09-30', today)).toBe(true);
  });
  it('refuses tomorrow, an impossible day, and anything not in YYYY-MM-DD', () => {
    expect(validPaymentDate('2026-10-06', today)).toBe(false);
    expect(validPaymentDate('2026-02-30', today)).toBe(false);
    expect(validPaymentDate('05/10/2026', today)).toBe(false);
    expect(validPaymentDate('', today)).toBe(false);
  });
});
