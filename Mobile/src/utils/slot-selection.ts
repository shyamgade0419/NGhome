/**
 * Which slots are selected after a tap. A booking is one slot, or — when the
 * amenity allows it — a run of consecutive slots. Kept pure so the rules are
 * testable without rendering a screen.
 */

export interface SelectableSlot {
  state: 'AVAILABLE' | 'FULL' | 'PAST' | 'TOO_FAR';
}

/** `start` is an index into the day's slot list; `count` consecutive slots from there. */
export interface Selection {
  start: number;
  count: number;
}

export function selectSlot(
  slots: SelectableSlot[],
  current: Selection | null,
  tapped: number,
  maxSlots: number,
): Selection | null {
  // A taken, past or too-far slot cannot be picked; tapping one changes nothing.
  if (slots[tapped]?.state !== 'AVAILABLE') return current;
  if (!current) return { start: tapped, count: 1 };

  const end = current.start + current.count; // index just after the selection
  const inside = tapped >= current.start && tapped < end;

  // Tapping the only selected slot again clears it.
  if (inside && current.count === 1) return null;
  // Tapping inside a longer selection restarts from that slot.
  if (inside) return { start: tapped, count: 1 };

  if (current.count < maxSlots) {
    if (tapped === end) return { start: current.start, count: current.count + 1 };
    if (tapped === current.start - 1) return { start: tapped, count: current.count + 1 };
  }
  // Anywhere else, or already at the limit: start over from the tapped slot.
  return { start: tapped, count: 1 };
}

/** Index of the last selected slot. */
export function selectionEnd(sel: Selection): number {
  return sel.start + sel.count - 1;
}
