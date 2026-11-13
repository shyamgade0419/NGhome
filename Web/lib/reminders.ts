/** One unpaid flat in a period, with who a reminder goes to and the message worded from the society's template. */
export interface BillReminder {
  billId: string;
  flatId: string;
  flatCode: string;
  userId: string | null;
  residentName: string | null;
  residentPhone: string | null;
  /** Who the reminder is for: the tenant when the flat has one, otherwise the owner. */
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

/** Sample values for the live preview while the admin writes a template. */
const SAMPLE: Record<string, string> = {
  name: 'Asha Rao', flat: 'A-101', month: 'October 2026', amount: '3,500', total: '4,000',
  dueDate: '10 Oct 2026', invoice: 'INV-0007', society: 'Your Society', upi: 'society@upi',
};

/** The template as one flat would receive it. A placeholder that is not known is left as typed, as the server does. */
export function previewReminder(template: string): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in SAMPLE ? SAMPLE[key] : whole));
}

/** What the settings screen shows about WhatsApp automation. */
export interface WhatsappStatus {
  /** What this society sends through is set up (the platform's gateway for a linked number; always true for a Meta account). */
  configured: boolean;
  /** How this society sends: a number it linked by QR code (OPENWA), or its own Meta WhatsApp Business account (CLOUD). */
  provider: 'OPENWA' | 'CLOUD';
  /** This society has somewhere to send from by the way it chose: a linked number, or a connected Meta account. */
  hasSession: boolean;
  /** Meta account only: the required message templates approved (null when it cannot be told). */
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

/** The gateway connection saved from the console (never the key) and where messages are sent from now. */
export interface WhatsappGatewayView {
  source: 'console' | 'environment' | 'none';
  url: string | null;
  hasKey: boolean;
  keyUnreadable: boolean;
  environment: { url: string | null; hasKey: boolean };
  updatedAt: string | null;
}

/** A society's own WhatsApp number: whether it is linked, and the QR code to scan while it is being linked. */
export interface WhatsappConnection {
  /** The platform has a gateway set up. */
  hasGateway: boolean;
  /** The platform owner has allowed this society to use WhatsApp. */
  allowed: boolean;
  /** This society has a session of its own on the gateway (it pressed Connect at least once). */
  linked: boolean;
  /** `ready` means the society's number is linked and messages can go out. */
  status: string | null;
  phone: string | null;
  qrCode: string | null;
  problem: string | null;
}

/** For the platform owner: every society that has linked a number, and any session on the gateway that belongs to none. */
export interface WhatsappSessionsOverview {
  configured: boolean;
  reachable: boolean;
  problem: string | null;
  sessions: { societyId: string; name: string; allowed: boolean; deleted: boolean; provider: 'OPENWA' | 'CLOUD'; status: string | null; phone: string | null }[];
  /** Societies that send through their own Meta account: nothing runs on the gateway for them. */
  cloud: { societyId: string; name: string; allowed: boolean; deleted: boolean; phone: string | null }[];
  orphans: { id: string; name: string; status: string; phone: string | null }[];
}

/** One of the four message templates Meta must approve before a society's Meta account can send. */
export interface WhatsappCloudTemplate {
  kind: string;
  name: string;
  /** APPROVED | PENDING | REJECTED | PAUSED | DISABLED | NOT_SUBMITTED | UNKNOWN */
  status: string;
  reason: string | null;
  /** Not needed to send: once approved it adds to a message (the receipt link on the payment confirmation). */
  optional?: boolean;
}

/** A society's own Meta WhatsApp Business (Cloud API) account. The access token is never sent back. */
export interface WhatsappCloud {
  allowed: boolean;
  provider: 'OPENWA' | 'CLOUD';
  linked: boolean;
  phoneNumberId: string | null;
  wabaId: string | null;
  displayPhone: string | null;
  verifiedName: string | null;
  /** `ready` when Meta accepts the token, `token_invalid` when it does not, `error` when Meta could not be asked. */
  status: 'ready' | 'token_invalid' | 'error' | null;
  problem: string | null;
  templates: WhatsappCloudTemplate[];
  templatesReady: boolean | null;
}
