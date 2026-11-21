import { ELECTRICITY_PROVIDERS, providerByCode } from './utility-providers';
import { cleanConsumerNumber, maskNumber, monthKey, nextReminderDate, reminderDue } from './utility-reminders';
import { utilityReminder } from '../notifications/notification-content';

/** An India time as a UTC instant: IST is UTC+5:30. */
const ist = (iso: string) => new Date(new Date(`${iso}Z`).getTime() - 5.5 * 3_600_000);

describe('the monthly reminder', () => {
  it('goes out on its day from 9 in the morning, India time, and not before', () => {
    expect(reminderDue(ist('2026-12-08T08:59:00'), 8, null)).toBe(false);
    expect(reminderDue(ist('2026-12-08T09:00:00'), 8, null)).toBe(true);
    expect(reminderDue(ist('2026-12-08T22:30:00'), 8, null)).toBe(true);
  });

  it('is not early: not the day before', () => {
    expect(reminderDue(ist('2026-12-07T15:00:00'), 8, null)).toBe(false);
  });

  it('goes once a month, however many times it is checked', () => {
    expect(reminderDue(ist('2026-12-08T10:00:00'), 8, '2026-12')).toBe(false);
    expect(reminderDue(ist('2026-12-08T10:00:00'), 8, '2026-11')).toBe(true); // last month's does not count
  });

  it('is still sent for two days after, if the server was down on its day, and then skipped until next month', () => {
    expect(reminderDue(ist('2026-12-10T10:00:00'), 8, null)).toBe(true);
    expect(reminderDue(ist('2026-12-11T10:00:00'), 8, null)).toBe(false);
  });

  it('follows the India calendar, not UTC: late evening in India is already the next UTC day', () => {
    // 8 Dec 23:50 IST is 8 Dec 18:20 UTC; 9 Dec 00:10 IST is still 8 Dec in UTC.
    expect(reminderDue(ist('2026-12-09T00:10:00'), 9, null)).toBe(false); // before 9 a.m. on the 9th
    expect(monthKey(ist('2026-12-01T00:10:00'))).toBe('2026-12');
    expect(monthKey(new Date('2026-11-30T20:00:00Z'))).toBe('2026-12'); // 1 Dec 01:30 in India
  });

  it('tells when the next one is', () => {
    expect(nextReminderDate(ist('2026-12-02T12:00:00'), 8, '2026-11')).toBe('2026-12-08'); // still to come this month
    expect(nextReminderDate(ist('2026-12-08T12:00:00'), 8, '2026-12')).toBe('2027-01-08'); // sent today
    expect(nextReminderDate(ist('2026-12-20T12:00:00'), 8, null)).toBe('2027-01-08'); // missed: next month
    expect(nextReminderDate(ist('2026-12-15T12:00:00'), 8, '2026-12')).toBe('2027-01-08'); // year end rolls over
  });
});

describe('the consumer number', () => {
  it('is kept in one form, so the same number cannot be saved twice by typing it differently', () => {
    expect(cleanConsumerNumber('  ab 1234   5678 ')).toBe('AB 1234 5678');
    expect(cleanConsumerNumber('ab12345678')).toBe('AB12345678');
  });
  it('shows only its last four characters when masked', () => {
    expect(maskNumber('1234 5678 9012')).toBe('•••• 9012');
    expect(maskNumber('AB12')).toBe('AB12');
  });
});

describe('the notification', () => {
  const base = { id: 'c1', providerCode: 'TGSPDCL', providerName: 'TGSPDCL (Southern Power, Telangana)', nickname: null as string | null, consumerNumber: '1234 5678 9012' };
  it('asks the person to check and pay, without claiming to know an amount or a due date', () => {
    const n = utilityReminder(base);
    expect(n.type).toBe('UTILITY_REMINDER');
    expect(n.title).toBe('Time to check your electricity bill');
    expect(n.body).toContain('Check and pay your TGSPDCL');
    expect(n.body).not.toMatch(/₹|Rs\.?\s?\d|due on|due date|due by/i);
    expect(n.data).toEqual({ connectionId: 'c1', providerCode: 'TGSPDCL' });
  });
  it('shows only the last four characters of the number, and prefers the nickname', () => {
    const n = utilityReminder({ ...base, nickname: 'Flat meter' });
    expect(n.body).toContain('Flat meter');
    expect(n.body).toContain('•••• 9012');
    expect(n.body).not.toContain('1234 5678');
  });
});

describe('the list of companies', () => {
  it('has a code, a name and an https website for each, and no code twice', () => {
    const codes = ELECTRICITY_PROVIDERS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const p of ELECTRICITY_PROVIDERS) {
      expect(p.name.length).toBeGreaterThan(3);
      expect(p.url).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    }
    expect(providerByCode('BESCOM')?.name).toContain('Bengaluru');
    expect(providerByCode('NOPE')).toBeUndefined();
  });
});
