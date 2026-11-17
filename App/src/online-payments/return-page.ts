import type { OrderOutcome } from './online-payments.service';

const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

interface Copy {
  tone: 'good' | 'wait' | 'bad';
  title: string;
  body: string;
}

function copyFor(outcome: OrderOutcome | 'UNKNOWN', amount: string | null): Copy {
  const rupees = amount ? `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : 'Your payment';
  switch (outcome) {
    case 'PAID':
      return { tone: 'good', title: 'Payment received', body: `${rupees} has been paid and recorded against your bill. You can close this page and go back to NG Home.` };
    case 'NEEDS_REVIEW':
      return { tone: 'good', title: 'Payment received', body: `${rupees} has been received. Your society will confirm it against your bill shortly. You can close this page and go back to NG Home.` };
    case 'EXPIRED':
      return { tone: 'bad', title: 'This payment page has expired', body: 'No money was taken for it. Go back to NG Home and start the payment again.' };
    case 'FAILED':
      return { tone: 'bad', title: 'The payment did not go through', body: 'If any money was taken from your account it comes back to you, usually within a few days. Go back to NG Home to try again.' };
    default:
      return { tone: 'wait', title: 'We are confirming your payment', body: 'If you have paid, it will show in NG Home in a minute or two. You can close this page and go back to the app.' };
  }
}

/** The page a person lands on after paying. A finished page with no script, no login and nothing from outside. */
export function renderReturnHtml(outcome: OrderOutcome | 'UNKNOWN', amount: string | null): string {
  const c = copyFor(outcome, amount);
  const colour = c.tone === 'good' ? '#166534' : c.tone === 'bad' ? '#9a3412' : '#0d2147';
  const mark = c.tone === 'good' ? '&#10003;' : c.tone === 'bad' ? '!' : '&#8230;';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(c.title)} | NG Home</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#eef3f8;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#14213d}
main{width:min(92vw,420px);padding:32px 26px;text-align:center;background:rgba(255,255,255,.88);border:1px solid #fff;border-radius:24px;box-shadow:0 20px 50px -20px rgba(13,33,71,.35)}
.mark{width:64px;height:64px;margin:0 auto 18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:700;color:#fff;background:${colour}}
h1{font-size:22px;margin:0 0 10px;color:${colour}}p{margin:0;line-height:1.55;color:#4a5873;font-size:15px}small{display:block;margin-top:22px;color:#66728c}
</style></head><body><main><div class="mark" aria-hidden="true">${mark}</div><h1>${esc(c.title)}</h1><p>${esc(c.body)}</p><small>NG Home &middot; Powered by NovaGade</small></main></body></html>`;
}
