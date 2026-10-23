import { selectSlot, selectionEnd, SelectableSlot } from '@/utils/slot-selection';

const A: SelectableSlot = { state: 'AVAILABLE' };
const F: SelectableSlot = { state: 'FULL' };
const P: SelectableSlot = { state: 'PAST' };

// index:  0  1  2  3  4  5
const day = [P, A, A, A, F, A];

describe('selectSlot', () => {
  it('picks a free slot', () => {
    expect(selectSlot(day, null, 2, 1)).toEqual({ start: 2, count: 1 });
  });

  it.each([0, 4, 99])('ignores a tap on slot %i that cannot be booked', (i) => {
    expect(selectSlot(day, null, i, 3)).toBeNull();
    expect(selectSlot(day, { start: 1, count: 1 }, i, 3)).toEqual({ start: 1, count: 1 });
  });

  it('clears the selection when the only selected slot is tapped again', () => {
    expect(selectSlot(day, { start: 2, count: 1 }, 2, 3)).toBeNull();
  });

  it('extends forward when the next slot is tapped and the amenity allows more', () => {
    expect(selectSlot(day, { start: 1, count: 1 }, 2, 3)).toEqual({ start: 1, count: 2 });
    expect(selectSlot(day, { start: 1, count: 2 }, 3, 3)).toEqual({ start: 1, count: 3 });
  });

  it('extends backward when the slot before is tapped', () => {
    expect(selectSlot(day, { start: 2, count: 1 }, 1, 3)).toEqual({ start: 1, count: 2 });
  });

  it('will not extend past the limit — it restarts from the tapped slot instead', () => {
    expect(selectSlot(day, { start: 1, count: 1 }, 2, 1)).toEqual({ start: 2, count: 1 });
    expect(selectSlot(day, { start: 1, count: 2 }, 3, 2)).toEqual({ start: 3, count: 1 });
  });

  it('cannot extend across a full slot — the run is not contiguous', () => {
    // 3 is selected; 4 is full (ignored); 5 is free but not adjacent, so it restarts.
    expect(selectSlot(day, { start: 3, count: 1 }, 4, 3)).toEqual({ start: 3, count: 1 });
    expect(selectSlot(day, { start: 3, count: 1 }, 5, 3)).toEqual({ start: 5, count: 1 });
  });

  it('restarts from a slot tapped inside a longer selection', () => {
    expect(selectSlot(day, { start: 1, count: 3 }, 2, 3)).toEqual({ start: 2, count: 1 });
  });

  it('restarts from a non-adjacent free slot', () => {
    expect(selectSlot([A, A, A, A, A], { start: 0, count: 1 }, 3, 3)).toEqual({ start: 3, count: 1 });
  });
});

describe('selectionEnd', () => {
  it('is the last selected index', () => {
    expect(selectionEnd({ start: 2, count: 3 })).toBe(4);
    expect(selectionEnd({ start: 5, count: 1 })).toBe(5);
  });
});
