/**
 * Builds a CSV that is safe to open in a spreadsheet. A cell that starts with
 * = + - @ (or a tab / carriage return) is executed as a formula by Excel and
 * Sheets, and these cells hold names and emails other people typed — so each
 * such cell is prefixed with an apostrophe to force it to be read as text.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  // A "+" followed only by digits, spaces and dashes is a phone number, not a
  // formula, and prefixing it would mangle every international number.
  if (/^[=+\-@\t\r]/.test(s) && !/^\+[\d\s-]+$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  // The BOM makes Excel read the file as UTF-8 rather than guessing wrong.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
