/**
 * Units used between two meter readings.
 *
 * A normal meter counts up: used = later − earlier. A faulty one can count down — the numbers fall
 * month to month (98362, then 98336: 26 used). That is a property of the meter, so it is recorded on
 * the flat (Flat.waterMeterReversed) and the reading is entered exactly as the dial shows it. The
 * direction is never guessed from the two numbers: a mistyped or replaced-meter reading looks just
 * like a reversed one, and guessing would bill it without anyone noticing.
 */

/** Units used, or null when the later reading is on the wrong side of the earlier one for this meter. */
export function waterConsumption(opening: number, closing: number, reversed: boolean): number | null {
  const used = reversed ? opening - closing : closing - opening;
  return used < 0 ? null : used;
}

/** The sentence to show when a reading is on the wrong side, naming which way this meter runs. */
export function readingOrderMessage(reversed: boolean, who?: string): string {
  const prefix = who ? `${who}: ` : '';
  return reversed
    ? `${prefix}This flat's meter counts down, so the closing reading must be less than or equal to the opening reading.`
    : `${prefix}Closing reading must be greater than or equal to opening reading. If this flat's meter counts down, mark it that way on the flat.`;
}
