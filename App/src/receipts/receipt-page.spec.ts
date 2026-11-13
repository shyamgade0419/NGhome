import { escapeHtml, methodLabel, renderNotFoundHtml, renderReceiptHtml, type ReceiptData } from './receipt-page';

const base: ReceiptData = {
  receiptNumber: 'RCT-3F9C2A1E',
  society: { name: 'Sunrise Residency', address: 'Plot 14, Hyderabad, Telangana' },
  paidOn: new Date('2026-11-08T05:00:00Z'),
  amount: 2500,
  method: 'UPI',
  reference: 'UTR123456789',
  payer: 'Ravi Kumar',
  flat: 'A-101',
  settled: [{ invoice: 'INV-102', month: 'October 2026', amount: 2500 }],
  balance: 0,
};

describe('receipt page', () => {
  it('shows who paid what, when, for which flat and which bills', () => {
    const html = renderReceiptHtml(base, 'n0nce');
    expect(html).toContain('Sunrise Residency');
    expect(html).toContain('Plot 14, Hyderabad, Telangana');
    expect(html).toContain('RCT-3F9C2A1E');
    expect(html).toContain('₹2,500.00');
    expect(html).toContain('8 November 2026');
    expect(html).toContain('Ravi Kumar');
    expect(html).toContain('A-101');
    expect(html).toContain('UTR123456789');
    expect(html).toContain('October 2026');
    expect(html).toContain('INV-102');
    expect(html).toContain('Nothing is due');
  });

  it('says what is still due when something is', () => {
    const html = renderReceiptHtml({ ...base, amount: 1000, balance: 1500 }, 'n');
    expect(html).toContain('Balance still due');
    expect(html).toContain('₹1,500.00');
    expect(html).not.toContain('Nothing is due');
  });

  it('leaves out what it does not have: no reference, no bills, no address', () => {
    const html = renderReceiptHtml({ ...base, reference: null, settled: [], society: { name: 'Sunrise', address: null } }, 'n');
    expect(html).not.toContain('Reference');
    expect(html).not.toContain('<table>');
  });

  it('escapes everything a person typed, so nothing in the app can change the page', () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&';
    const html = renderReceiptHtml({
      ...base,
      payer: evil,
      reference: evil,
      flat: evil,
      society: { name: evil, address: evil },
      settled: [{ invoice: evil, month: evil, amount: 1 }],
    }, 'n');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('onerror=alert(2)>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // the page's own single script, and nothing else, is the only <script> element
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it('carries the nonce on its one script, and cannot be given one that breaks out of the attribute', () => {
    expect(renderReceiptHtml(base, 'abc123==')).toContain('<script nonce="abc123==">');
    const html = renderReceiptHtml(base, '"><script>x</script>');
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('nonce="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"');
  });

  it('is a finished page that asks nothing of the outside world', () => {
    const html = renderReceiptHtml(base, 'n');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('noindex');
    expect(html).not.toMatch(/(src|href)=["']https?:/i);
    expect(html).not.toMatch(/@import|url\(/i);
  });

  it('says nothing about why a link is wrong', () => {
    const html = renderNotFoundHtml();
    expect(html).toContain('not valid');
    expect(html).not.toMatch(/signature|token|payment|expired|tamper/i);
  });

  it('escapes the five characters that matter, and treats nothing as empty', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(5)).toBe('5');
  });

  it('names the ways of paying for people', () => {
    expect(methodLabel('UPI')).toBe('UPI');
    expect(methodLabel('BANK_TRANSFER')).toBe('Bank transfer');
    expect(methodLabel('SOMETHING_NEW')).toBe('Something new');
  });
});
