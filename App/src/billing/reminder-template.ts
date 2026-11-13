/**
 * The words of a payment reminder, written once by the admin and filled in per flat.
 *
 * Stored in the society's additionalConfig (`reminderTemplate`) so no migration is needed. WhatsApp reads `*bold*`
 * and `_italic_` itself, so the default uses them.
 */
export const DEFAULT_REMINDER_TEMPLATE = [
  'Dear {name},',
  '',
  'This is a gentle reminder that the *{month}* maintenance for Flat *{flat}* is still unpaid.',
  '',
  'Amount due: *₹{amount}*',
  'Due date: *{dueDate}*',
  '',
  'Please pay and upload the payment in the NG Home app. Ignore this message if you have already paid.',
  '',
  '_{society}_',
].join('\n');

/**
 * The follow-up: the reminder a flat gets when it has already been reminded about this bill and still has not paid. Stored in
 * `finalReminderTemplate`; a society that has not written its own gets this, a little firmer than the first.
 */
export const DEFAULT_FINAL_REMINDER_TEMPLATE = [
  'Dear {name},',
  '',
  'This is a *second reminder*: the *{month}* maintenance for Flat *{flat}* is still unpaid.',
  '',
  'Amount due: *₹{amount}*',
  'Due date: *{dueDate}*',
  '',
  'Please pay at the earliest in the NG Home app. Ignore this message if you have already paid.',
  '',
  '_{society}_',
].join('\n');

export const MAX_TEMPLATE_LENGTH = 1500;

export const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The placeholders a template may use, with what each becomes — shown to the admin as they write. */
export const REMINDER_PLACEHOLDERS: { token: string; meaning: string }[] = [
  { token: '{name}', meaning: "the resident's name" },
  { token: '{flat}', meaning: 'the flat number' },
  { token: '{month}', meaning: 'the billing month, e.g. October 2026' },
  { token: '{amount}', meaning: 'what the flat still owes' },
  { token: '{total}', meaning: 'the full amount of this bill' },
  { token: '{dueDate}', meaning: 'the due date' },
  { token: '{invoice}', meaning: 'the invoice number' },
  { token: '{society}', meaning: 'the society name' },
  { token: '{upi}', meaning: "the society's UPI ID, if one is set" },
];

export interface ReminderVars {
  name: string;
  flat: string;
  month: string;
  amount: string;
  total: string;
  dueDate: string;
  invoice: string;
  society: string;
  upi: string;
}

/** What is stored, tolerating a missing or non-text value: the admin's template, or the default. */
export function readReminderTemplate(additionalConfig: unknown): string {
  const raw = (additionalConfig as { reminderTemplate?: unknown } | null | undefined)?.reminderTemplate;
  return typeof raw === 'string' && raw.trim() ? raw : DEFAULT_REMINDER_TEMPLATE;
}

/** The follow-up wording stored, or the default. */
export function readFinalReminderTemplate(additionalConfig: unknown): string {
  const raw = (additionalConfig as { finalReminderTemplate?: unknown } | null | undefined)?.finalReminderTemplate;
  return typeof raw === 'string' && raw.trim() ? raw : DEFAULT_FINAL_REMINDER_TEMPLATE;
}

/**
 * Fill a template. A placeholder is replaced wherever it appears; one that is not known is left as written so a
 * typo shows up in the preview instead of silently vanishing. A value is inserted literally — `$&` and the like in
 * a name do nothing special.
 */
export function renderReminder(template: string, vars: ReminderVars): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key as keyof ReminderVars] : whole,
  );
}
