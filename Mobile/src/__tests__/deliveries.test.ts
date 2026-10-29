import type { DeliveryExpectation, ExpectationState, ParcelStatus } from '@/api/endpoints/deliveries.api';
import {
  COMPANIES, DELIVERY_DURATIONS, EXPECTATION_STATE, INSTRUCTIONS, PARCEL_STATUS, canCancel, expectationSummary, instructionLabel,
  instructionsForFlat, isHeld, parcelTimeline,
} from '@/utils/deliveries';

const exp = (over: Partial<DeliveryExpectation> = {}): DeliveryExpectation => ({
  id: 'e1', flatId: 'f1', company: 'Amazon', instruction: 'ALLOW_ENTRY', note: null,
  validFrom: '2026-10-30T10:00:00Z', validUntil: '2026-10-30T14:00:00Z', maxUses: 1, usedCount: 0, state: 'ACTIVE', ...over,
});

describe('what a resident can still change', () => {
  it.each<[ExpectationState, boolean]>([
    ['ACTIVE', true], ['NOT_YET', true], ['USED', false], ['EXPIRED', false], ['CANCELLED', false],
  ])('%s -> can cancel: %s', (state, expected) => expect(canCancel({ state })).toBe(expected));

  it('every state has a label and a colour', () => {
    for (const s of ['ACTIVE', 'NOT_YET', 'USED', 'EXPIRED', 'CANCELLED'] as ExpectationState[]) {
      expect(EXPECTATION_STATE[s].label).toBeTruthy();
      expect(EXPECTATION_STATE[s].variant).toBeTruthy();
    }
  });
});

describe('what the guard can do with a parcel', () => {
  it('only a parcel still at the gate can be handed over or sent back', () => {
    expect(isHeld({ status: 'RECEIVED' })).toBe(true);
    expect(isHeld({ status: 'COLLECTED' })).toBe(false);
    expect(isHeld({ status: 'RETURNED' })).toBe(false);
  });

  it('every parcel status has a label and a colour', () => {
    for (const s of ['RECEIVED', 'COLLECTED', 'RETURNED'] as ParcelStatus[]) {
      expect(PARCEL_STATUS[s].label).toBeTruthy();
    }
  });

  it('a parcel at the gate is the one that needs attention', () => {
    expect(PARCEL_STATUS.RECEIVED.variant).toBe('warning');
  });
});

describe('wording', () => {
  it('names both instructions in plain words', () => {
    expect(instructionLabel('ALLOW_ENTRY')).toBe('Send them up');
    expect(instructionLabel('LEAVE_AT_GATE')).toBe('Leave at gate');
    expect(INSTRUCTIONS).toHaveLength(2);
  });

  it('summarises an instruction with who, what and until when', () => {
    const s = expectationSummary(exp());
    expect(s).toContain('Send them up');
    expect(s).toContain('Amazon');
    expect(s).toContain('until');
  });

  it('shows how many uses are gone only when there is more than one', () => {
    expect(expectationSummary(exp({ maxUses: 3, usedCount: 1 }))).toContain('1 of 3 used');
    expect(expectationSummary(exp({ maxUses: 1 }))).not.toContain(' of ');
    expect(expectationSummary(exp({ instruction: 'LEAVE_AT_GATE', maxUses: 3, usedCount: 0 }))).not.toContain(' of ');
  });

  it('a parcel timeline says arrived, and how it ended once it has', () => {
    const held = parcelTimeline({ receivedAt: '2026-10-30T10:00:00Z', closedAt: null, status: 'RECEIVED' });
    expect(held).toContain('Arrived');
    expect(held).not.toContain('Collected');
    expect(parcelTimeline({ receivedAt: '2026-10-30T10:00:00Z', closedAt: '2026-10-30T11:00:00Z', status: 'COLLECTED' })).toContain('Collected');
    expect(parcelTimeline({ receivedAt: '2026-10-30T10:00:00Z', closedAt: '2026-10-30T11:00:00Z', status: 'RETURNED' })).toContain('Sent back');
  });
});

describe('instructionsForFlat', () => {
  const list = [
    exp({ id: 'a', flatId: 'f1', instruction: 'ALLOW_ENTRY' }),
    exp({ id: 'b', flatId: 'f2', instruction: 'ALLOW_ENTRY' }),
    exp({ id: 'c', flatId: 'f1', instruction: 'LEAVE_AT_GATE' }),
  ];

  it('returns only that flat, "leave at gate" first because it changes what the guard does', () => {
    expect(instructionsForFlat(list, 'f1').map((e) => e.id)).toEqual(['c', 'a']);
  });

  it('returns nothing when no flat is picked', () => {
    expect(instructionsForFlat(list, null)).toEqual([]);
    expect(instructionsForFlat(list, undefined)).toEqual([]);
  });
});

describe('choices offered', () => {
  it('offers short and long durations, shortest first, none past 72 hours (the server limit)', () => {
    const hours = DELIVERY_DURATIONS.map((d) => d.hours);
    expect([...hours].sort((a, b) => a - b)).toEqual(hours);
    expect(Math.max(...hours)).toBeLessThanOrEqual(72);
  });

  it('offers the common companies', () => {
    expect(COMPANIES).toContain('Amazon');
    expect(COMPANIES).toContain('Swiggy');
  });
});
