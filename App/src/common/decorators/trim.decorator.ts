import { Transform } from 'class-transformer';

/**
 * Strips leading/trailing whitespace from a string field before validation,
 * so "Green Valley " is stored — and later matched, searched and typed back
 * as a confirmation — as "Green Valley". Non-strings pass through untouched
 * for the validators to reject.
 */
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
