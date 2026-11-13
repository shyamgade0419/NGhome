/**
 * The receipt page: one self-contained HTML page (no outside files) that a resident opens from the WhatsApp link, reads on
 * a phone, and saves or prints as a PDF from the browser. Every value that came from a person (names, notes, references)
 * is escaped, so nothing typed into the app can change the page.
 */

export interface ReceiptData {
  receiptNumber: string;
  society: { name: string; address: string | null };
  paidOn: Date;
  amount: number;
  method: string;
  reference: string | null;
  payer: string;
  flat: string;
  /** The bills this payment settled, oldest first. */
  settled: Array<{ invoice: string; month: string; amount: number }>;
  /** What the flat still owes, as of now. */
  balance: number;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const money = (n: number): string => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date): string => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

export const METHOD_LABEL: Record<string, string> = {
  UPI: 'UPI', CASH: 'Cash', CHEQUE: 'Cheque', BANK_TRANSFER: 'Bank transfer', NEFT: 'NEFT', RTGS: 'RTGS', IMPS: 'IMPS', ONLINE: 'Online', CARD: 'Card', OTHER: 'Other',
};
export const methodLabel = (m: string): string => METHOD_LABEL[m] ?? m.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** The page. `nonce` lets the one small script (the Print button) run under a strict content policy. */
export function renderReceiptHtml(r: ReceiptData, nonce: string): string {
  const rows = r.settled
    .map((s) => `<tr><td>${escapeHtml(s.month)}</td><td>${escapeHtml(s.invoice)}</td><td class="num">${money(s.amount)}</td></tr>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Receipt ${escapeHtml(r.receiptNumber)}</title>
<style>
  :root { color-scheme: light; --ink:#14181F; --muted:#5A6270; --line:#E0D8C6; --navy:#0D2147; --green:#0E9F6E; --bg:#F5F1E8; }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; }
  .sheet { max-width:560px; margin:0 auto; background:#fff; border:1px solid var(--line); border-radius:16px; overflow:hidden; }
  header { background:var(--navy); color:#fff; padding:20px 22px; }
  header h1 { margin:0; font-size:19px; }
  header p { margin:2px 0 0; font-size:13px; opacity:.8; }
  .paid { display:inline-block; margin-top:12px; padding:3px 12px; border-radius:999px; background:var(--green); color:#fff; font-weight:700; font-size:12px; letter-spacing:.06em; }
  .body { padding:20px 22px; }
  .amount { font-size:32px; font-weight:800; margin:0; }
  .meta { display:grid; grid-template-columns:auto 1fr; gap:6px 16px; margin:16px 0; font-size:14px; }
  .meta dt { color:var(--muted); }
  .meta dd { margin:0; text-align:right; word-break:break-word; }
  table { width:100%; border-collapse:collapse; margin-top:8px; font-size:14px; }
  th { text-align:left; color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.05em; border-bottom:1px solid var(--line); padding:6px 0; }
  td { padding:8px 0; border-bottom:1px solid var(--line); }
  .num { text-align:right; white-space:nowrap; }
  .balance { display:flex; justify-content:space-between; margin-top:14px; padding:10px 12px; border-radius:10px; background:#F7F3EA; font-size:14px; }
  footer { padding:14px 22px 20px; color:var(--muted); font-size:12px; }
  button { margin-top:10px; padding:9px 16px; border:1px solid var(--navy); border-radius:10px; background:#fff; color:var(--navy); font:inherit; font-weight:600; cursor:pointer; }
  @media print { body { background:#fff; padding:0; } .sheet { border:0; border-radius:0; } button { display:none; } header { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
</style>
</head>
<body>
<main class="sheet">
  <header>
    <h1>${escapeHtml(r.society.name)}</h1>
    ${r.society.address ? `<p>${escapeHtml(r.society.address)}</p>` : ''}
    <span class="paid">PAYMENT RECEIVED</span>
  </header>
  <section class="body">
    <p class="amount">${money(r.amount)}</p>
    <dl class="meta">
      <dt>Receipt no.</dt><dd>${escapeHtml(r.receiptNumber)}</dd>
      <dt>Date</dt><dd>${escapeHtml(day(r.paidOn))}</dd>
      <dt>Received from</dt><dd>${escapeHtml(r.payer)}</dd>
      <dt>Flat</dt><dd>${escapeHtml(r.flat)}</dd>
      <dt>Paid by</dt><dd>${escapeHtml(methodLabel(r.method))}</dd>
      ${r.reference ? `<dt>Reference</dt><dd>${escapeHtml(r.reference)}</dd>` : ''}
    </dl>
    ${rows ? `<table><thead><tr><th>Month</th><th>Invoice</th><th class="num">Settled</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
    <div class="balance"><span>${r.balance > 0 ? 'Balance still due' : 'Nothing is due'}</span><strong>${r.balance > 0 ? money(r.balance) : '✓'}</strong></div>
    <button id="print" type="button">Print or save as PDF</button>
  </section>
  <footer>This is a computer-generated receipt issued through NG Home. It needs no signature.</footer>
</main>
<script nonce="${escapeHtml(nonce)}">document.getElementById('print').addEventListener('click', function () { window.print(); });</script>
</body>
</html>`;
}

/** What anyone gets for a link that is wrong or for a payment that is not a received one: nothing about why. */
export function renderNotFoundHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Receipt not found</title>
<style>body{margin:0;padding:40px 20px;background:#F5F1E8;color:#14181F;font:16px/1.5 system-ui,-apple-system,Arial,sans-serif;text-align:center}</style></head>
<body><h1 style="font-size:20px">This receipt link is not valid</h1><p>Check that you opened the whole link from the message. If it still does not open, ask your society office for a copy.</p></body></html>`;
}
