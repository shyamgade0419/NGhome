/** A flat's electricity connection and its monthly reminder. */

export interface UtilityProvider {
  code: string;
  name: string;
  region: string;
  url: string;
}

export interface UtilityConnection {
  id: string;
  providerCode: string;
  providerName: string;
  /** The company's website to pay on (https). */
  providerUrl: string | null;
  consumerNumber: string;
  nickname: string | null;
  reminderDay: number;
  remindersOn: boolean;
  /** "YYYY-MM-DD" of the next reminder; null while reminders are off. */
  nextReminder: string | null;
}

export const OTHER = 'OTHER';
export const MAX_CONNECTIONS = 5;
export const DEFAULT_DAY = 8;

const NUMBER = /^[A-Za-z0-9][A-Za-z0-9 \-/]{2,24}$/;

/** What the server keeps: trimmed, one space between parts, capitals. */
export const tidyNumber = (text: string): string => text.trim().replace(/\s+/g, ' ').toUpperCase();
export const isValidNumber = (text: string): boolean => NUMBER.test(text.trim());

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th, 21st, 22nd. */
export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** The reminder day kept to the days every month has. */
export const clampDay = (n: number): number => Math.min(28, Math.max(1, Math.round(n)));

/** "8 Dec 2026" for a "YYYY-MM-DD" date, written out so it does not depend on the phone's time zone. */
export function dateText(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

/** A website address is opened only if it is a plain https link. */
export const isHttps = (url: string | null | undefined): url is string => !!url && /^https:\/\/[^\s/]+\.[^\s/]+/i.test(url);
