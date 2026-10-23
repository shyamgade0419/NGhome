/**
 * The slot arithmetic decides whether a booking is valid, so it is tested
 * exhaustively on its own. All expected instants are written as UTC so the
 * India offset (+05:30) is visible in the test rather than hidden by it.
 */

import {
  checkBookingWindow,
  generateSlots,
  istDateString,
  istDayStartUtc,
  istMinutesOfDay,
  istMonthRangeUtc,
} from './amenity-time';

const RULES = { slotMinutes: 60, opensAtMin: 360, closesAtMin: 1320 }; // 06:00–22:00 IST

describe('istDayStartUtc', () => {
  it('is 18:30 UTC the evening before', () => {
    expect(istDayStartUtc('2026-11-04')?.toISOString()).toBe('2026-11-03T18:30:00.000Z');
  });

  it.each(['2026-02-31', '2026-13-01', '2026-00-10', 'abc', '2026-1-1', '', '2026-11-04T00:00:00Z'])(
    'rejects %j',
    (value) => {
      expect(istDayStartUtc(value)).toBeNull();
    },
  );

  it('accepts a leap day only in a leap year', () => {
    expect(istDayStartUtc('2028-02-29')).not.toBeNull();
    expect(istDayStartUtc('2027-02-29')).toBeNull();
  });
});

describe('istMinutesOfDay', () => {
  it.each([
    ['2026-11-03T18:30:00Z', 0],
    ['2026-11-04T00:30:00Z', 360],
    ['2026-11-04T16:30:00Z', 1320],
    ['2026-11-04T18:29:00Z', 1439],
  ])('%s -> %i', (iso, expected) => {
    expect(istMinutesOfDay(new Date(iso))).toBe(expected);
  });
});

describe('istDateString', () => {
  it('rolls over to the next day after 18:30 UTC', () => {
    expect(istDateString(new Date('2026-11-03T18:29:00Z'))).toBe('2026-11-03');
    expect(istDateString(new Date('2026-11-03T18:30:00Z'))).toBe('2026-11-04');
  });
});

describe('istMonthRangeUtc', () => {
  it('spans the IST month, not the UTC one', () => {
    const { start, end } = istMonthRangeUtc(new Date('2026-11-15T10:00:00Z'));
    expect(start.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-11-30T18:30:00.000Z');
  });

  it('puts 01:30 IST on the 1st in the new month even though UTC is still the old one', () => {
    const { start } = istMonthRangeUtc(new Date('2026-11-30T20:00:00Z'));
    expect(start.toISOString()).toBe('2026-11-30T18:30:00.000Z');
  });

  it('handles December into January', () => {
    const { end } = istMonthRangeUtc(new Date('2026-12-10T10:00:00Z'));
    expect(end.toISOString()).toBe('2026-12-31T18:30:00.000Z');
  });
});

describe('generateSlots', () => {
  it('offers every hour from 06:00 to 22:00', () => {
    const slots = generateSlots(RULES, '2026-11-04');
    expect(slots).toHaveLength(16);
    expect(slots[0].startAt.toISOString()).toBe('2026-11-04T00:30:00.000Z'); // 06:00 IST
    expect(slots[15].endAt.toISOString()).toBe('2026-11-04T16:30:00.000Z'); // 22:00 IST
  });

  it('chains slots end to start with no gap or overlap', () => {
    const slots = generateSlots(RULES, '2026-11-04');
    for (let i = 1; i < slots.length; i++) expect(slots[i].startAt.getTime()).toBe(slots[i - 1].endAt.getTime());
  });

  it('drops a final slot that would run past closing time', () => {
    const slots = generateSlots({ slotMinutes: 90, opensAtMin: 360, closesAtMin: 1320 }, '2026-11-04');
    expect(slots).toHaveLength(10); // 960 minutes / 90 = 10.67
    expect(slots[9].endAt.toISOString()).toBe('2026-11-04T15:30:00.000Z'); // 21:00 IST, not 22:30
  });

  it('is empty for an invalid date or a non-positive slot length', () => {
    expect(generateSlots(RULES, '2026-02-31')).toEqual([]);
    expect(generateSlots({ ...RULES, slotMinutes: 0 }, '2026-11-04')).toEqual([]);
  });
});

describe('checkBookingWindow', () => {
  const at = (hhmmIst: string) => {
    const [h, m] = hhmmIst.split(':').map(Number);
    return new Date(Date.UTC(2026, 10, 3, 18, 30) + (h * 60 + m) * 60_000);
  };

  it('accepts a slot on the grid and returns its end', () => {
    const result = checkBookingWindow(RULES, at('18:00'), 1);
    expect(result).toEqual({ ok: true, endAt: at('19:00') });
  });

  it('accepts several consecutive slots, up to closing time exactly', () => {
    expect(checkBookingWindow(RULES, at('20:00'), 2)).toEqual({ ok: true, endAt: at('22:00') });
  });

  it('refuses a start between slots', () => {
    expect(checkBookingWindow(RULES, at('18:30'), 1)).toEqual({ ok: false, reason: 'That is not a valid slot start.' });
  });

  it('refuses a start before opening', () => {
    expect(checkBookingWindow(RULES, at('05:00'), 1).ok).toBe(false);
  });

  it('refuses a booking that runs past closing time', () => {
    expect(checkBookingWindow(RULES, at('21:00'), 2)).toEqual({ ok: false, reason: 'That booking runs past closing time.' });
  });

  it('refuses a start that is not on a whole minute', () => {
    expect(checkBookingWindow(RULES, new Date(at('18:00').getTime() + 1), 1).ok).toBe(false);
  });

  it.each([0, -1, 1.5, NaN])('refuses %p slots', (count) => {
    expect(checkBookingWindow(RULES, at('18:00'), count).ok).toBe(false);
  });

  it('measures the grid from opening time, not from midnight', () => {
    const odd = { slotMinutes: 60, opensAtMin: 390, closesAtMin: 1290 }; // opens 06:30
    expect(checkBookingWindow(odd, at('06:30'), 1).ok).toBe(true);
    expect(checkBookingWindow(odd, at('07:00'), 1).ok).toBe(false);
  });
});
