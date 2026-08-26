export function generateInvoiceNumber(prefix: string, currentNumber: number): string {
  const padded = String(currentNumber).padStart(6, '0');
  return `${prefix}-${padded}`;
}

export function formatPeriod(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}
