/**
 * The message templates NG Home sends through Meta's WhatsApp Business Cloud API.
 *
 * WhatsApp only lets a business send free text to someone who messaged it in the last 24 hours. Everything NG Home sends
 * (a bill is ready, a reminder, a late fine, a payment received) is business-initiated, so each has to be a template that
 * Meta approved beforehand: fixed wording with numbered blanks, {{1}} {{2}} ... filled in per message. A society submits
 * these four once (Settings → Billing Rules → WhatsApp), and Meta usually approves them within minutes to a day. The wording
 * is fixed once approved, so unlike the OpenWA number the society cannot reword them from NG Home.
 *
 * Meta's rules these follow: UTILITY category (transactional), a blank is never the first or last thing in the text,
 * and every blank has an example value.
 */

export type CloudKind = 'BILL_PUBLISHED' | 'REMINDER' | 'REMINDER_FINAL' | 'FINE_IMPOSED' | 'PAYMENT_RECEIVED' | 'PAYMENT_RECEIPT' | 'MEETING' | 'EVENT';

export const CLOUD_LANGUAGE = 'en';
/** Meta's own greeting template, present on a new business account, used for the "send a test" button. */
export const TEST_TEMPLATE = { name: 'hello_world', language: 'en_US' };

export interface CloudTemplate {
  kind: CloudKind;
  /** Lower case letters, digits and underscores only: Meta's rule for template names. */
  name: string;
  /** The wording, with {{1}}, {{2}} ... for the blanks. */
  text: string;
  /** What each blank holds, in order. */
  params: string[];
  /** One example per blank, which Meta asks for when a template is submitted. */
  samples: string[];
  /**
   * Not needed to send: a society can send everything without it. It is submitted with the others and, once Meta approves it,
   * improves one message (the payment confirmation gains the receipt link). Until then the message goes without the link,
   * so a society that has not (re)submitted is never held up by it.
   */
  optional?: boolean;
}

export const CLOUD_TEMPLATES: CloudTemplate[] = [
  {
    kind: 'BILL_PUBLISHED',
    name: 'ng_bill_published',
    text: 'Hello {{1}}, your {{2}} maintenance bill for Flat {{3}} is ready. Amount due: ₹{{4}}. Due date: {{5}}. Please pay and upload the payment in the NG Home app. Sent on behalf of {{6}} via NG Home.',
    params: ['name', 'month', 'flat', 'amount', 'dueDate', 'society'],
    samples: ['Ravi Kumar', 'Nov 2026', 'A-101', '2,500', '10 Nov 2026', 'Sunrise Residency'],
  },
  {
    kind: 'REMINDER',
    name: 'ng_payment_reminder',
    text: 'Hello {{1}}, this is a reminder that maintenance for Flat {{2}} ({{3}}) is still unpaid. Amount due: ₹{{4}}. Due date: {{5}}. Please pay in the NG Home app. If you have already paid, please ignore this message. Sent on behalf of {{6}} via NG Home.',
    params: ['name', 'flat', 'month', 'amount', 'dueDate', 'society'],
    samples: ['Ravi Kumar', 'A-101', 'Nov 2026', '2,500', '10 Nov 2026', 'Sunrise Residency'],
  },
  {
    // The follow-up reminder, for a flat already reminded about this bill. Optional: until Meta approves it the usual reminder
    // goes instead, so a society that has not submitted it is never held up.
    kind: 'REMINDER_FINAL',
    name: 'ng_payment_reminder_final',
    optional: true,
    text: 'Hello {{1}}, this is a second reminder that maintenance for Flat {{2}} ({{3}}) is still unpaid. Amount due: ₹{{4}}. Due date: {{5}}. Please pay at the earliest in the NG Home app. If you have already paid, please ignore this message. Sent on behalf of {{6}} via NG Home.',
    params: ['name', 'flat', 'month', 'amount', 'dueDate', 'society'],
    samples: ['Ravi Kumar', 'A-101', 'Nov 2026', '2,500', '10 Nov 2026', 'Sunrise Residency'],
  },
  {
    kind: 'FINE_IMPOSED',
    name: 'ng_late_fine',
    text: 'Hello {{1}}, the {{2}} maintenance for Flat {{3}} was not paid by the due date, so a late fine of ₹{{4}} has been added. Amount now due: ₹{{5}}. Please pay at the earliest in the NG Home app. Sent on behalf of {{6}} via NG Home.',
    params: ['name', 'month', 'flat', 'fee', 'amount', 'society'],
    samples: ['Ravi Kumar', 'Nov 2026', 'A-101', '100', '2,600', 'Sunrise Residency'],
  },
  {
    kind: 'PAYMENT_RECEIVED',
    name: 'ng_payment_received',
    text: 'Hello {{1}}, we have received ₹{{2}} for Flat {{3}} on {{4}}. Thank you! Balance still due: ₹{{5}}. Sent on behalf of {{6}} via NG Home.',
    params: ['name', 'amount', 'flat', 'paidOn', 'balance', 'society'],
    samples: ['Ravi Kumar', '2,500', 'A-101', '8 Nov 2026', '0', 'Sunrise Residency'],
  },
  {
    // The payment confirmation with a link to the receipt. Meta cannot edit an approved template, so this is a new one beside
    // ng_payment_received, which stays as the fallback.
    kind: 'PAYMENT_RECEIPT',
    name: 'ng_payment_receipt',
    optional: true,
    text: 'Hello {{1}}, we have received ₹{{2}} for Flat {{3}} on {{4}}. Thank you! Balance still due: ₹{{5}}. Your receipt is here: {{6}} - sent on behalf of {{7}} via NG Home.',
    params: ['name', 'amount', 'flat', 'paidOn', 'balance', 'receipt', 'society'],
    samples: ['Ravi Kumar', '2,500', 'A-101', '8 Nov 2026', '0', 'https://nghome-api.novagade.in/api/v1/public/receipts/AbCdEfGhIjKlMnOpQrStUv.AbCdEfGhIjKlMnOpQrStUv', 'Sunrise Residency'],
  },
  {
    // A meeting: scheduled, the day before, moved. The second blank says which ('a society meeting has been scheduled'). Optional:
    // a society that has not had it approved still sends everything else, and just sends no meeting messages on WhatsApp.
    kind: 'MEETING',
    name: 'ng_meeting_notice',
    optional: true,
    text: 'Hello {{1}}, {{2}}: {{3}}. When: {{4}}. Where: {{5}}. Sent on behalf of {{6}} via NG Home.',
    params: ['name', 'lead', 'title', 'when', 'where', 'society'],
    samples: ['Ravi Kumar', 'a society meeting has been scheduled', 'Annual General Meeting', 'Sat, 14 Nov, 6:00 pm', 'Clubhouse', 'Sunrise Residency'],
  },
  {
    // An event: planned, the day before, moved, cancelled. Optional in the same way.
    kind: 'EVENT',
    name: 'ng_event_notice',
    optional: true,
    text: 'Hello {{1}}, {{2}}: {{3}}. When: {{4}}. Details: {{5}}. Sent on behalf of {{6}} via NG Home.',
    params: ['name', 'lead', 'title', 'when', 'details', 'society'],
    samples: ['Ravi Kumar', 'a new society event has been planned', 'Diwali get-together', 'Sat, 14 Nov, 6:00 pm', 'Snacks and music for all', 'Sunrise Residency'],
  },
];

export const templateOf = (kind: string): CloudTemplate | undefined => CLOUD_TEMPLATES.find((t) => t.kind === kind);

/** Whether a template is one a society can send without. */
export const isOptionalTemplate = (kind: string): boolean => templateOf(kind)?.optional === true;

/**
 * A value as Meta accepts it in a blank: one line, no tabs, no run of four spaces, not empty and at most 1,024
 * characters. A name with a line break in it would otherwise make Meta refuse the whole message.
 */
export function cleanParam(value: unknown): string {
  const text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim()
    .slice(0, 1024);
  return text === '' ? '-' : text;
}

/** The values in the order the template's blanks want them. */
export function orderedParams(t: CloudTemplate, values: Record<string, unknown>): string[] {
  return t.params.map((key) => cleanParam(values[key]));
}

/** The message as the recipient reads it: the template's wording with the blanks filled in. */
export function renderTemplate(t: CloudTemplate, values: Record<string, unknown>): string {
  const filled = orderedParams(t, values);
  return t.text.replace(/\{\{(\d+)\}\}/g, (_, n: string) => filled[Number(n) - 1] ?? '');
}
