import {
  allowedDurations,
  awaitingResident,
  canCheckOut,
  canLetIn,
  canOverride,
  formatCodeInput,
  isCompleteCode,
  newRequestId,
  phoneForApi,
  shareMessage,
  tidyVehicle,
  timeline,
  validUntilFrom,
  ENTRY_STATUS,
} from '@/utils/visitors';
import type { VisitorEntryStatus } from '@/api/endpoints/visitors.api';

const STATUSES: VisitorEntryStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CHECKED_IN', 'CHECKED_OUT', 'EXPIRED'];

describe('what the gate may offer', () => {
  it('lets a guard let in only an approved visitor', () => {
    expect(STATUSES.filter((status) => canLetIn({ status }))).toEqual(['APPROVED']);
  });

  it('lets a guard check out only someone who is inside', () => {
    expect(STATUSES.filter((status) => canCheckOut({ status }))).toEqual(['CHECKED_IN']);
  });

  it('shows a resident an answer button only while the request is waiting', () => {
    expect(STATUSES.filter((status) => awaitingResident({ status }))).toEqual(['PENDING_APPROVAL']);
  });

  it('lets the committee override only an unanswered or lapsed request', () => {
    expect(STATUSES.filter((status) => canOverride({ status }))).toEqual(['PENDING_APPROVAL', 'EXPIRED']);
  });

  it('has a label and colour for every status', () => {
    STATUSES.forEach((s) => expect(ENTRY_STATUS[s].label).toBeTruthy());
  });
});

describe('invitation durations', () => {
  it('offers only what the society allows', () => {
    expect(allowedDurations(1).map((d) => d.hours)).toEqual([2, 6, 12, 24]);
    expect(allowedDurations(3).map((d) => d.hours)).toEqual([2, 6, 12, 24, 72]);
    expect(allowedDurations(7).map((d) => d.hours)).toEqual([2, 6, 12, 24, 72, 168]);
  });

  it('always offers at least the shortest', () => {
    expect(allowedDurations(0).length).toBe(1);
  });

  it('counts the hours from now', () => {
    const now = new Date('2026-10-28T10:00:00Z');
    expect(validUntilFrom(now, 6)).toBe('2026-10-28T16:00:00.000Z');
  });
});

describe('shareMessage', () => {
  const msg = shareMessage({ code: 'K7QX-92MD', visitorName: 'Ravi', societyName: 'Green Valley', validUntil: '2026-10-29T12:30:00Z' });

  it('carries the code and when it works, in India time', () => {
    expect(msg).toContain('K7QX-92MD');
    expect(msg).toContain('6:00 PM');
    expect(msg).toContain('Green Valley');
  });

  it('shares nothing about the resident or the flat', () => {
    expect(msg).not.toMatch(/flat|block|\bA-\d|phone|@/i);
  });

  it('still reads well without a society name', () => {
    expect(shareMessage({ code: 'AAAA-BBBB', visitorName: 'Ravi', validUntil: '2026-10-29T12:30:00Z' })).toContain('entry code is AAAA-BBBB');
  });
});

describe('code entry', () => {
  it.each([
    ['k7qx92md', 'K7QX-92MD'],
    ['k7qx-92md', 'K7QX-92MD'],
    [' k7 qx 92 md ', 'K7QX-92MD'],
    ['K7QX', 'K7QX'],
    ['K7QX9', 'K7QX-9'],
    ['K7QX92MDEXTRA', 'K7QX-92MD'],
    ['', ''],
  ])('tidies %j as %j', (typed, shown) => expect(formatCodeInput(typed)).toBe(shown));

  it('knows when eight characters have been entered', () => {
    expect(isCompleteCode('K7QX-92MD')).toBe(true);
    expect(isCompleteCode('K7QX-92M')).toBe(false);
    expect(isCompleteCode('')).toBe(false);
  });
});

describe('newRequestId', () => {
  it('is different every time', () => {
    expect(new Set(Array.from({ length: 1000 }, newRequestId)).size).toBe(1000);
  });
  it('fits the server limit of 64 characters', () => {
    expect(newRequestId().length).toBeLessThanOrEqual(64);
  });
});

describe('input tidying', () => {
  it.each([
    ['ts09 ab 1234', 'TS09 AB 1234'],
    ['ts09-ab-1234!', 'TS09-AB-1234'],
    ['x'.repeat(30), 'X'.repeat(20)],
  ])('vehicle %j -> %j', (typed, out) => expect(tidyVehicle(typed)).toBe(out));

  it.each([
    ['98123 45678', '9812345678'],
    ['+91 98123-45678', '+919812345678'],
    ['(040) 2345 6789', '04023456789'],
    ['call me', undefined],
    ['123', undefined],
    ['', undefined],
  ])('phone %j -> %j', (typed, out) => expect(phoneForApi(typed)).toBe(out));
});

describe('timeline', () => {
  it('builds up as the visit goes on', () => {
    const base = { requestedAt: '2026-10-28T12:40:00Z', checkedInAt: null, checkedOutAt: null, status: 'PENDING_APPROVAL' as const };
    expect(timeline(base)).toBe('Wed, 28 Oct, 6:10 PM');
    expect(timeline({ ...base, checkedInAt: '2026-10-28T12:50:00Z', status: 'CHECKED_IN' })).toBe('Wed, 28 Oct, 6:10 PM · In 6:20 PM');
    expect(timeline({ ...base, checkedInAt: '2026-10-28T12:50:00Z', checkedOutAt: '2026-10-28T13:35:00Z', status: 'CHECKED_OUT' })).toBe(
      'Wed, 28 Oct, 6:10 PM · In 6:20 PM · Out 7:05 PM',
    );
  });
});
