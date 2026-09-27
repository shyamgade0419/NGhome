import { buildUpiUri } from '@/utils/upi';

describe('buildUpiUri', () => {
  it('builds a pay link with the UPI ID, name, note and INR — and no amount', () => {
    const uri = buildUpiUri('me@okhdfcbank', 'NG Home');

    expect(uri).toBe('upi://pay?pa=me%40okhdfcbank&pn=NG%20Home&tn=Support%20NG%20Home&cu=INR');
    // The payer chooses how much (or whether) to send.
    expect(uri).not.toContain('am=');
  });

  it('encodes characters that would otherwise corrupt the link', () => {
    const uri = buildUpiUri('9876543210@ybl', 'Shyam & Co #1');

    expect(uri).toContain('pn=Shyam%20%26%20Co%20%231');
    // Exactly the four parameters — a raw "&" in the name did not add a fifth.
    expect(uri.split('?')[1].split('&')).toHaveLength(4);
  });
});
