import {
  ATTENDANCE_LIMITS, addDays, dateAllowed, dateRange, formatTime, isLate, monthDates, parseDate, parseTime, summarize, weekdayOf, workedMinutes,
} from './attendance-rules';

describe('dates', () => {
  it('accepts only real calendar dates', () => {
    expect(parseDate('2026-10-30')?.toISOString()).toBe('2026-10-30T00:00:00.000Z');
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '30-10-2026', '', 'today', null, undefined, 20261030]) expect(parseDate(bad)).toBeNull();
    expect(parseDate('2028-02-29')).not.toBeNull(); // a leap day
    expect(parseDate('2026-02-29')).toBeNull();
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('knows the weekday (0 is Sunday)', () => {
    expect(weekdayOf('2026-10-30')).toBe(5); // a Friday
    expect(weekdayOf('2026-11-01')).toBe(0); // a Sunday
  });

  it('lists a range inclusively, and refuses a backwards, bad or oversized one', () => {
    expect(dateRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(dateRange('2026-10-30', '2026-10-30')).toEqual(['2026-10-30']);
    expect(dateRange('2026-11-02', '2026-10-30')).toBeNull();
    expect(dateRange('2026-10-30', 'x')).toBeNull();
    expect(dateRange('2026-01-01', '2026-12-31')).toBeNull();
    expect(dateRange('2026-01-01', '2026-03-03')).toHaveLength(62);
    expect(dateRange('2026-01-01', '2026-03-04')).toBeNull();
  });

  it('lists the days of a month, including February in a leap year', () => {
    expect(monthDates('2026-10')).toHaveLength(31);
    expect(monthDates('2026-11')).toHaveLength(30);
    expect(monthDates('2026-02')).toHaveLength(28);
    expect(monthDates('2028-02')).toHaveLength(29);
    expect(monthDates('2026-13')).toBeNull();
    expect(monthDates('2026-1')).toBeNull();
    expect(monthDates('2026-10')![0]).toBe('2026-10-01');
  });
});

describe('times', () => {
  it.each([['00:00', 0], ['06:30', 390], ['23:59', 1439]])('%s is minute %d', (s, m) => {
    expect(parseTime(s)).toBe(m);
    expect(formatTime(m)).toBe(s);
  });

  it.each([['24:00'], ['6:30'], ['06:60'], ['0630'], [''], [null], [630]])('%j is not a time', (s) => expect(parseTime(s)).toBeNull());
});

describe('which dates may be changed', () => {
  const today = '2026-10-30';
  it('allows today and the recent past, not the future, not far back', () => {
    expect(dateAllowed('2026-10-30', today)).toEqual({ ok: true });
    expect(dateAllowed('2026-10-01', today)).toEqual({ ok: true });
    expect(dateAllowed('2026-10-31', today)).toMatchObject({ ok: false, reason: expect.stringContaining('not happened') });
    expect(dateAllowed(addDays(today, -ATTENDANCE_LIMITS.backDays), today)).toEqual({ ok: true });
    expect(dateAllowed(addDays(today, -ATTENDANCE_LIMITS.backDays - 1), today)).toMatchObject({ ok: false });
    expect(dateAllowed('nope', today)).toMatchObject({ ok: false });
  });

  it('lets a roster look ahead when asked', () => {
    expect(dateAllowed('2026-11-15', today, { future: true })).toEqual({ ok: true });
  });
});

describe('late', () => {
  it('is judged against the shift start with a grace period', () => {
    const start = 6 * 60; // 06:00
    expect(isLate(start, 6 * 60)).toBe(false);
    expect(isLate(start, 6 * 60 + 15)).toBe(false); // on the grace limit
    expect(isLate(start, 6 * 60 + 16)).toBe(true);
    expect(isLate(start, 5 * 60 + 30)).toBe(false); // early
    expect(isLate(start, 12 * 60)).toBe(true);
  });

  it('judges a night shift across midnight', () => {
    const start = 22 * 60; // 22:00
    expect(isLate(start, 22 * 60 + 20)).toBe(true);
    expect(isLate(start, 21 * 60 + 50)).toBe(false);
    expect(isLate(start, 0 * 60 + 30)).toBe(true); // 00:30 is 2.5 h after the start
  });

  it('never calls an arrival more than 12 hours before the start late', () => {
    expect(isLate(6 * 60, 20 * 60)).toBe(false); // 14 h after -> reads as the evening before
    expect(isLate(6 * 60, 18 * 60)).toBe(true); // exactly 12 h after still counts
  });
});

describe('worked minutes', () => {
  it('is the span between check-in and check-out', () => {
    expect(workedMinutes(new Date('2026-10-30T03:00:00Z'), new Date('2026-10-30T11:30:00Z'))).toBe(510);
    expect(workedMinutes(null, new Date())).toBeNull();
    expect(workedMinutes(new Date(), null)).toBeNull();
    expect(workedMinutes(new Date('2026-10-30T11:00:00Z'), new Date('2026-10-30T10:00:00Z'))).toBeNull();
  });
});

describe('summarize', () => {
  const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'];
  const att = (rows: Record<string, { status: any; at?: number | null; worked?: number | null }>) =>
    new Map(Object.entries(rows).map(([d, r]) => [d, { status: r.status, checkInMinuteOfDay: r.at ?? null, worked: r.worked ?? null }]));
  const ros = (rows: Record<string, number | null>) => new Map(Object.entries(rows).map(([d, s]) => [d, { shiftStartMinute: s }]));

  it('counts each status, blank days, planned days off, lateness and hours', () => {
    const s = summarize({
      dates,
      attendance: att({
        '2026-10-01': { status: 'PRESENT', at: 6 * 60, worked: 480 },
        '2026-10-02': { status: 'PRESENT', at: 6 * 60 + 40, worked: 450 },
        '2026-10-03': { status: 'HALF_DAY', at: 6 * 60, worked: 240 },
        '2026-10-04': { status: 'ABSENT' },
        '2026-10-05': { status: 'LEAVE' },
      }),
      roster: ros({ '2026-10-01': 360, '2026-10-02': 360, '2026-10-03': 360, '2026-10-06': null }),
    });
    expect(s).toEqual({ present: 2, halfDay: 1, absent: 1, leave: 1, scheduledOff: 1, unmarked: 0, late: 1, daysWorked: 2.5, workedMinutes: 1170 });
  });

  it('a day with no row and no plan is unmarked; a planned day off is not', () => {
    const s = summarize({ dates, attendance: att({}), roster: ros({ '2026-10-02': null }) });
    expect(s.unmarked).toBe(5);
    expect(s.scheduledOff).toBe(1);
  });

  it('a day with a row is counted by the row even if the roster said day off', () => {
    const s = summarize({ dates: ['2026-10-02'], attendance: att({ '2026-10-02': { status: 'PRESENT' } }), roster: ros({ '2026-10-02': null }) });
    expect(s).toMatchObject({ present: 1, scheduledOff: 0, unmarked: 0 });
  });

  it('skips days before the person joined and after they left', () => {
    const s = summarize({ dates, joinDate: '2026-10-03', exitDate: '2026-10-05', attendance: att({ '2026-10-01': { status: 'PRESENT' } }), roster: ros({}) });
    expect(s.present).toBe(0); // before joining: not counted at all
    expect(s.unmarked).toBe(3); // 3rd, 4th, 5th
  });

  it('cannot tell lateness without a roster shift, so it does not guess', () => {
    const s = summarize({ dates: ['2026-10-01'], attendance: att({ '2026-10-01': { status: 'PRESENT', at: 23 * 60 } }), roster: ros({}) });
    expect(s.late).toBe(0);
  });
});
