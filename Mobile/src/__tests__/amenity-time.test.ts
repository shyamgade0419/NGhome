import {
  addDays, fmtDay, fmtDayOf, fmtMinutes, fmtRange, fmtTime, istDateString, minutesToHHMM, parseHHMM,
} from '@/utils/amenity-time';

describe('India-time formatting', () => {
  // 2026-11-04 18:00 IST == 12:30 UTC. Wednesday.
  const SIX_PM = '2026-11-04T12:30:00.000Z';

  it('shows the hour in India time, whatever zone the phone is in', () => {
    expect(fmtTime(SIX_PM)).toBe('6:00 PM');
    expect(fmtTime('2026-11-03T18:30:00.000Z')).toBe('12:00 AM'); // midnight IST
    expect(fmtTime('2026-11-04T06:30:00.000Z')).toBe('12:00 PM'); // noon IST
    expect(fmtTime('2026-11-04T00:30:00.000Z')).toBe('6:00 AM');
  });

  it('keeps minutes', () => {
    expect(fmtTime('2026-11-04T13:00:00.000Z')).toBe('6:30 PM');
  });

  it('rolls the date over at midnight IST, not midnight UTC', () => {
    expect(istDateString('2026-11-03T18:29:00.000Z')).toBe('2026-11-03');
    expect(istDateString('2026-11-03T18:30:00.000Z')).toBe('2026-11-04');
  });

  it('labels days with the right weekday', () => {
    expect(fmtDay('2026-11-04')).toBe('Wed, 4 Nov');
    expect(fmtDay('2026-12-31')).toBe('Thu, 31 Dec');
    expect(fmtDayOf(SIX_PM)).toBe('Wed, 4 Nov');
  });

  it('formats a booking range', () => {
    expect(fmtRange(SIX_PM, '2026-11-04T13:30:00.000Z')).toBe('Wed, 4 Nov · 6:00 PM – 7:00 PM');
  });
});

describe('addDays', () => {
  it.each([
    ['2026-11-04', 1, '2026-11-05'],
    ['2026-11-30', 1, '2026-12-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2027-02-28', 1, '2027-03-01'],
    ['2026-11-04', 0, '2026-11-04'],
    ['2026-11-04', -4, '2026-10-31'],
  ])('%s + %i = %s', (from, n, expected) => {
    expect(addDays(from, n)).toBe(expected);
  });
});

describe('opening-hours text', () => {
  it('converts minutes to HH:MM', () => {
    expect(minutesToHHMM(360)).toBe('06:00');
    expect(minutesToHHMM(1320)).toBe('22:00');
    expect(minutesToHHMM(1439)).toBe('23:59');
    expect(minutesToHHMM(0)).toBe('00:00');
  });

  it.each([
    ['06:00', 360],
    ['6:00', 360],
    ['18:30', 1110],
    ['00:00', 0],
    ['24:00', 1440],
    [' 22:00 ', 1320],
  ])('parses %j as %i', (text, minutes) => {
    expect(parseHHMM(text)).toBe(minutes);
  });

  it.each(['', '6', '6pm', '25:00', '24:30', '12:60', '12:5', 'ab:cd', '-1:00'])('rejects %j', (text) => {
    expect(parseHHMM(text)).toBeNull();
  });
});

describe('fmtMinutes', () => {
  it.each([
    [360, '6:00 AM'],
    [1320, '10:00 PM'],
    [720, '12:00 PM'],
    [0, '12:00 AM'],
    [1440, '12:00 AM'],
    [1110, '6:30 PM'],
  ])('%i -> %s', (min, label) => {
    expect(fmtMinutes(min)).toBe(label);
  });
});
