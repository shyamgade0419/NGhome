import type { GateStaff } from '@/api/endpoints/staff.api';
import { canCheckIn, canCheckOut, dutyLine, dutySummary, staffBadge, timesLine } from '@/utils/staff';

const base: GateStaff = {
  employeeId: 'e1', name: 'Ravi', designation: 'Security', shiftName: null, shiftStart: null, shiftEnd: null, post: null, dayOff: false,
  status: null, checkInAt: null, checkOutAt: null, inside: false,
};
const s = (over: Partial<GateStaff>): GateStaff => ({ ...base, ...over });

describe('the badge', () => {
  it('shows the most important thing first', () => {
    expect(staffBadge(s({ inside: true, checkInAt: '2026-10-30T00:30:00Z', status: 'PRESENT' }))).toEqual({ label: 'Inside', variant: 'success' });
    expect(staffBadge(s({ checkInAt: '2026-10-30T00:30:00Z', checkOutAt: '2026-10-30T08:30:00Z', status: 'PRESENT' }))).toEqual({ label: 'Left', variant: 'neutral' });
    expect(staffBadge(s({ status: 'ABSENT' }))).toEqual({ label: 'Absent', variant: 'error' });
    expect(staffBadge(s({ status: 'LEAVE' }))).toEqual({ label: 'On leave', variant: 'info' });
    expect(staffBadge(s({ dayOff: true }))).toEqual({ label: 'Day off', variant: 'neutral' });
    expect(staffBadge(s({}))).toEqual({ label: 'Not in yet', variant: 'warning' });
  });

  it('being inside beats everything else', () => {
    expect(staffBadge(s({ inside: true, status: 'ABSENT', dayOff: true })).label).toBe('Inside');
  });
});

describe('which button the guard sees', () => {
  it('offers check-in only when nobody has checked them in today', () => {
    expect(canCheckIn(s({}))).toBe(true);
    expect(canCheckIn(s({ checkInAt: '2026-10-30T00:30:00Z' }))).toBe(false);
    expect(canCheckIn(s({ inside: true, checkInAt: '2026-10-30T00:30:00Z' }))).toBe(false);
  });

  it('offers check-out only while they are inside', () => {
    expect(canCheckOut(s({ inside: true }))).toBe(true);
    expect(canCheckOut(s({}))).toBe(false);
    expect(canCheckOut(s({ checkInAt: '2026-10-30T00:30:00Z', checkOutAt: '2026-10-30T08:30:00Z' }))).toBe(false);
  });

  it('a person marked absent can still be checked in: they have plainly come', () => {
    expect(canCheckIn(s({ status: 'ABSENT' }))).toBe(true);
  });

  it('a day off does not stop a check-in either', () => {
    expect(canCheckIn(s({ dayOff: true }))).toBe(true);
  });
});

describe('wording', () => {
  it('describes the duty with shift, hours and post, or the day off', () => {
    expect(dutyLine(s({ shiftName: 'Morning', shiftStart: '06:00', shiftEnd: '14:00', post: 'Main gate' }))).toBe('Morning 06:00–14:00 · Main gate');
    expect(dutyLine(s({ shiftName: 'Night', shiftStart: '22:00', shiftEnd: '06:00' }))).toBe('Night 22:00–06:00');
    expect(dutyLine(s({ dayOff: true }))).toBe('Day off today');
    expect(dutyLine(s({}))).toBeNull();
  });

  it('shows the times that exist', () => {
    expect(timesLine(s({}))).toBeNull();
    expect(timesLine(s({ checkInAt: '2026-10-30T00:35:00Z' }))).toMatch(/^In /);
    expect(timesLine(s({ checkInAt: '2026-10-30T00:35:00Z', checkOutAt: '2026-10-30T08:40:00Z' }))).toMatch(/^In .* · Out /);
  });

  it('summarises how many are in and how many on duty are still to come', () => {
    const list = [
      s({ inside: true, shiftName: 'Morning', checkInAt: 'x' }),
      s({ shiftName: 'Morning' }),
      s({ shiftName: 'Night' }),
      s({}), // not on duty: not counted as "to come"
    ];
    expect(dutySummary(list)).toBe('1 inside · 2 still to come');
    expect(dutySummary([s({ inside: true, shiftName: 'Morning', checkInAt: 'x' })])).toBe('1 inside');
    expect(dutySummary([])).toBe('0 inside');
  });
});
