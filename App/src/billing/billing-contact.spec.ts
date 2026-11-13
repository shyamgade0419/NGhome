import { describeContact, pickBillContact } from './billing-contact';
import { DEFAULT_FINAL_REMINDER_TEMPLATE, DEFAULT_REMINDER_TEMPLATE, readFinalReminderTemplate, readReminderTemplate, renderReminder } from './reminder-template';

const person = (
  first: string,
  residencyType: 'OWNER' | 'TENANT',
  over: { isPrimary?: boolean; joined?: string; phone?: string | null } = {},
) => ({
  residencyType,
  isPrimary: over.isPrimary ?? false,
  joinedAt: new Date(over.joined ?? '2026-01-01'),
  user: { firstName: first, lastName: 'X', phone: over.phone === undefined ? '9999999999' : over.phone },
});

describe('who a flat\'s reminder goes to', () => {
  it('is the tenant when the flat has both an owner and a tenant', () => {
    const picked = pickBillContact([person('Owner', 'OWNER', { isPrimary: true }), person('Tenant', 'TENANT')]);
    expect(picked?.user.firstName).toBe('Tenant');
  });

  it('is the tenant whichever order they are listed in', () => {
    const picked = pickBillContact([person('Tenant', 'TENANT'), person('Owner', 'OWNER', { isPrimary: true })]);
    expect(picked?.user.firstName).toBe('Tenant');
  });

  it('is the owner when there is no tenant', () => {
    expect(pickBillContact([person('Owner', 'OWNER')])?.user.firstName).toBe('Owner');
  });

  it('prefers the primary resident, then the earliest to join, within the same kind', () => {
    const picked = pickBillContact([
      person('Late', 'TENANT', { joined: '2026-06-01' }),
      person('Primary', 'TENANT', { isPrimary: true, joined: '2026-07-01' }),
      person('Early', 'TENANT', { joined: '2026-02-01' }),
    ]);
    expect(picked?.user.firstName).toBe('Primary');
    expect(
      pickBillContact([person('Late', 'OWNER', { joined: '2026-06-01' }), person('Early', 'OWNER', { joined: '2026-02-01' })])?.user.firstName,
    ).toBe('Early');
  });

  it('is nobody for an empty flat, and does not reorder what it was given', () => {
    expect(pickBillContact([])).toBeNull();
    const list = [person('Owner', 'OWNER'), person('Tenant', 'TENANT')];
    pickBillContact(list);
    expect(list[0].user.firstName).toBe('Owner');
  });

  it('describes the person for the admin, and tolerates no phone number', () => {
    expect(describeContact(person('Asha', 'TENANT'))).toEqual({ residentName: 'Asha X', residentPhone: '9999999999', residentType: 'TENANT' });
    expect(describeContact(person('Ravi', 'OWNER', { phone: null })).residentPhone).toBeNull();
    expect(describeContact(null)).toEqual({ residentName: null, residentPhone: null, residentType: null });
  });
});

describe('the reminder template', () => {
  const vars = {
    name: 'Asha', flat: 'A-101', month: 'October 2026', amount: '3,500', total: '4,000',
    dueDate: '10 Oct 2026', invoice: 'INV-7', society: 'Green Park', upi: 'gp@upi',
  };

  it('fills every placeholder wherever it appears', () => {
    expect(renderReminder('{flat}: {name} owes ₹{amount} of {total} for {month} — {flat}', vars)).toBe(
      'A-101: Asha owes ₹3,500 of 4,000 for October 2026 — A-101',
    );
  });

  it('leaves an unknown placeholder as written, so a typo is visible', () => {
    expect(renderReminder('Hi {nmae}, pay {amount}', vars)).toBe('Hi {nmae}, pay 3,500');
  });

  it('inserts values literally — a name with $& in it does nothing special', () => {
    expect(renderReminder('Dear {name}', { ...vars, name: '$& $1 Rao' })).toBe('Dear $& $1 Rao');
  });

  it('uses the default wording until the admin writes their own, and treats blank as unset', () => {
    expect(readReminderTemplate(undefined)).toBe(DEFAULT_REMINDER_TEMPLATE);
    expect(readReminderTemplate({ reminderTemplate: '   ' })).toBe(DEFAULT_REMINDER_TEMPLATE);
    expect(readReminderTemplate({ reminderTemplate: 5 })).toBe(DEFAULT_REMINDER_TEMPLATE);
    expect(readReminderTemplate({ reminderTemplate: 'Pay {amount}' })).toBe('Pay {amount}');
  });

  it('the default wording uses only placeholders that exist', () => {
    const out = renderReminder(DEFAULT_REMINDER_TEMPLATE, vars);
    expect(out).not.toMatch(/\{\w+\}/);
    expect(out).toContain('Dear Asha');
    expect(out).toContain('A-101');
  });

  describe('the follow-up reminder', () => {
    it('is its own wording, kept apart from the first, and a society that has not written one gets the default', () => {
      expect(readFinalReminderTemplate(undefined)).toBe(DEFAULT_FINAL_REMINDER_TEMPLATE);
      expect(readFinalReminderTemplate(null)).toBe(DEFAULT_FINAL_REMINDER_TEMPLATE);
      expect(readFinalReminderTemplate({})).toBe(DEFAULT_FINAL_REMINDER_TEMPLATE);
      expect(readFinalReminderTemplate({ finalReminderTemplate: '   ' })).toBe(DEFAULT_FINAL_REMINDER_TEMPLATE);
      expect(readFinalReminderTemplate({ finalReminderTemplate: 7 })).toBe(DEFAULT_FINAL_REMINDER_TEMPLATE);
      expect(readFinalReminderTemplate({ finalReminderTemplate: 'Second chance {name}' })).toBe('Second chance {name}');
      // writing only the first does not change the follow-up, and the other way round
      expect(readFinalReminderTemplate({ reminderTemplate: 'First only' })).toBe(DEFAULT_FINAL_REMINDER_TEMPLATE);
      expect(readReminderTemplate({ finalReminderTemplate: 'Follow-up only' })).toBe(DEFAULT_REMINDER_TEMPLATE);
    });

    it('says it is a second reminder, unlike the first, and uses only placeholders that exist', () => {
      expect(DEFAULT_FINAL_REMINDER_TEMPLATE).not.toBe(DEFAULT_REMINDER_TEMPLATE);
      const out = renderReminder(DEFAULT_FINAL_REMINDER_TEMPLATE, vars);
      expect(out).toContain('second reminder');
      expect(out).not.toMatch(/\{\w+\}/);
      expect(out).toContain('Dear Asha');
      expect(out).toContain('A-101');
      expect(renderReminder(DEFAULT_REMINDER_TEMPLATE, vars)).not.toContain('second reminder');
    });
  });
});
