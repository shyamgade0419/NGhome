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

/** What the settings screen shows about WhatsApp automation. */
export interface WhatsappStatus {
  /** The server has a WhatsApp gateway set up. */
  configured: boolean;
  /** How this society sends: a number it linked by QR code on the web (OPENWA), or its own Meta WhatsApp Business account (CLOUD). */
  provider: 'OPENWA' | 'CLOUD';
  /** This society has somewhere to send from by the way it chose (a linked number, or a connected Meta account), set up on the web. */
  hasSession: boolean;
  /** Meta account only: all four message templates approved (null when it cannot be told). */
  templatesReady: boolean | null;
  /** The platform owner has allowed this society to use WhatsApp. Without it the society cannot switch messages on. */
  allowed: boolean;
  enabled: boolean;
  reminderDays: number[];
  /** The gateway's session: `ready` is the only state in which messages go out. */
  session: string | null;
  sendingFrom: string | null;
  problem: string | null;
  queued: number;
  sentToday: number;
  failedThisWeek: number;
}

export interface WhatsappMessageRow {
  id: string;
  kind: string;
  toPhone: string;
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export const WHATSAPP_KIND_LABEL: Record<string, string> = {
  BILL_PUBLISHED: 'Bill published',
  REMINDER: 'Reminder',
  FINE_IMPOSED: 'Late fine',
  PAYMENT_RECEIVED: 'Payment received',
  TEST: 'Test',
};

/** "5, 10" typed by the admin into the days a reminder goes out: whole days 1–28, once each, in order. */
export function parseReminderDays(text: string): number[] {
  const days = text.split(/[\s,;]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 28);
  return Array.from(new Set(days)).sort((a, b) => a - b).slice(0, 6);
}
