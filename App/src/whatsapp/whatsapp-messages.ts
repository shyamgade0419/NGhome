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

export function paidMessage(v: { name: string; flat: string; amount: number | string; paidOn: string; balance: number | string; society: string }): string {
  const lines = [
    `Dear ${v.name},`,
    '',
    `✅ We have received *${rupees(v.amount)}* for Flat *${v.flat}* on ${v.paidOn}. Thank you!`,
  ];
  if (Number(v.balance) > 0) lines.push('', `Balance still due: *${rupees(v.balance)}*`);
  lines.push('', `_${v.society}_`);
  return lines.join('\n');
}
