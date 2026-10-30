/**
 * Units used between two water meter readings. Mirrors the server (App/src/water/water-rules.ts),
 * which is what enforces it: an ordinary meter counts up, a faulty one can count down, and which one
 * a flat has is the flat's own setting (Flat.waterMeterReversed) — never guessed from the numbers.
 */

/** Units used, or null when the later reading is on the wrong side of the earlier one for this meter. */
export function waterUnits(opening: number, closing: number, reversed: boolean): number | null {
  const used = reversed ? opening - closing : closing - opening;
  return used < 0 ? null : used;
}

/** What to tell the person when a reading is the wrong way round for this flat's meter. */
export function readingProblem(flatCode: string, opening: string, reversed: boolean): string {
  return reversed
    ? `Flat ${flatCode}: its meter counts down, so the current reading cannot be higher than the previous one (${opening}).`
    : `Flat ${flatCode}: the current reading cannot be lower than the previous one (${opening}). If this meter counts down, mark it that way on the flat (on the web: Flats → Edit).`;
}

/** Short label under a row when the reading is the wrong way round. */
export const wrongWayLabel = (reversed: boolean) => (reversed ? 'Above previous' : 'Below previous');
