/**
 * The wording of the automatic WhatsApp messages. The payment reminder is the society's own template (see
 * billing/reminder-template.ts); these three are fixed. WhatsApp reads `*bold*` and `_italic_` itself.
 */

const rupees = (n: number | string): string => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function publishedMessage(v: { name: string; flat: string; month: string; pending: number | string; dueDate: string; society: string }): string {
  return [
    `Dear ${v.name},`,
    '',
    `Your *${v.month}* maintenance bill for Flat *${v.flat}* is ready.`,
    '',
    `Amount: *${rupees(v.pending)}*`,
    `Due date: *${v.dueDate}*`,
    '',
    'Please pay and upload the payment in the NG Home app.',
    '',
    `_${v.society}_`,
  ].join('\n');
}

export function fineMessage(v: { name: string; flat: string; month: string; fee: number | string; pending: number | string; society: string }): string {
  return [
    `Dear ${v.name},`,
    '',
    `The *${v.month}* maintenance for Flat *${v.flat}* was not paid by the due date, so a late fine of *${rupees(v.fee)}* has been added.`,
    '',
    `Amount now due: *${rupees(v.pending)}*`,
    '',
    'Please pay at the earliest in the NG Home app.',
    '',
    `_${v.society}_`,
  ].join('\n');
}

export function paidMessage(v: { name: string; flat: string; amount: number | string; paidOn: string; balance: number | string; society: string; receiptUrl?: string }): string {
  const lines = [
    `Dear ${v.name},`,
    '',
    `✅ We have received *${rupees(v.amount)}* for Flat *${v.flat}* on ${v.paidOn}. Thank you!`,
  ];
  if (Number(v.balance) > 0) lines.push('', `Balance still due: *${rupees(v.balance)}*`);
  if (v.receiptUrl) lines.push('', '🧾 Your receipt:', v.receiptUrl);
  lines.push('', `_${v.society}_`);
  return lines.join('\n');
}

export type NoticeType = 'MEETING' | 'EVENT';
export type NoticeStage = 'NEW' | 'REMINDER' | 'MOVED' | 'CANCELLED';

/** The opening line of a meeting or event message: what has happened. */
export function noticeLead(type: NoticeType, stage: NoticeStage): string {
  const what = type === 'MEETING' ? 'society meeting' : 'society event';
  switch (stage) {
    case 'REMINDER': return `reminder: your ${what} is tomorrow`;
    case 'MOVED': return `a ${what} has been moved to a new time`;
    case 'CANCELLED': return `a ${what} has been cancelled`;
    default: return type === 'MEETING' ? 'a society meeting has been scheduled' : 'a new society event has been planned';
  }
}

/** A meeting or event message for a linked number. `where` is a meeting's place; `details` an event's description or a meeting's agenda. */
export function noticeMessage(v: { name: string; type: NoticeType; stage: NoticeStage; title: string; when: string; where?: string | null; details?: string | null; society: string }): string {
  const lead = noticeLead(v.type, v.stage);
  const lines = [`Dear ${v.name},`, '', `${lead.charAt(0).toUpperCase()}${lead.slice(1)}:`, `*${v.title}*`, '', `🗓 ${v.when}`];
  if (v.where && v.where.trim()) lines.push(`📍 ${v.where.trim()}`);
  if (v.details && v.details.trim()) lines.push('', v.details.trim());
  lines.push('', `_${v.society}_`);
  return lines.join('\n');
}
