/** One unpaid flat in a period, with who a reminder goes to and the message worded from the society's template. */
export interface BillReminder {
  billId: string;
  flatId: string;
  flatCode: string;
  userId: string | null;
  residentName: string | null;
  residentPhone: string | null;
  /** The tenant when the flat has one, otherwise the owner. */
  residentType: 'OWNER' | 'TENANT' | null;
  pendingAmount: string;
  message: string;
}

export interface ReminderTemplate {
  template: string;
  isDefault: boolean;
  defaultTemplate: string;
  placeholders: { token: string; meaning: string }[];
}

/** wa.me wants digits with a country code; a bare 10-digit Indian number gets 91 in front. */
export function whatsappUrl(message: string, phone?: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return `https://wa.me/?text=${encodeURIComponent(message)}`;
  const e164 = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${e164}?text=${encodeURIComponent(message)}`;
}

const SAMPLE: Record<string, string> = {
  name: 'Asha Rao', flat: 'A-101', month: 'October 2026', amount: '3,500', total: '4,000',
  dueDate: '10 Oct 2026', invoice: 'INV-0007', society: 'Your Society', upi: 'society@upi',
};

/** The template as one flat would receive it. A placeholder that is not known is left as typed, as the server does. */
export function previewReminder(template: string): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in SAMPLE ? SAMPLE[key] : whole));
}

/** A payment date typed as YYYY-MM-DD: real calendar day, not in the future. */
export function validPaymentDate(value: string, today = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return false;
  return d.getTime() <= new Date(today.toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
}
