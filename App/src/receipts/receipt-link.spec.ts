import { DEFAULT_PUBLIC_API_URL, makeReceiptToken, readReceiptToken, receiptNumber, receiptSecret, receiptUrl } from './receipt-link';

const SECRET = 'receipt-link:0123456789abcdef0123456789abcdef';
const ID = '3f9c2a1e-7b44-4c1d-9a0e-5d6b8c7e1f20';
const OTHER_ID = '3f9c2a1e-7b44-4c1d-9a0e-5d6b8c7e1f21';

describe('receipt link', () => {
  describe('token', () => {
    it('is short, and reads back to the payment it was made for', () => {
      const token = makeReceiptToken(ID, SECRET)!;
      expect(token).toHaveLength(45);
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/);
      expect(readReceiptToken(token, SECRET)).toBe(ID);
    });

    it('is different for every payment and the same each time for one', () => {
      expect(makeReceiptToken(ID, SECRET)).toBe(makeReceiptToken(ID, SECRET));
      expect(makeReceiptToken(ID, SECRET)).not.toBe(makeReceiptToken(OTHER_ID, SECRET));
      expect(makeReceiptToken(ID.toUpperCase(), SECRET)).toBe(makeReceiptToken(ID, SECRET)); // a payment id has one spelling
    });

    it('fails when any single character is changed, in the id part or the signature', () => {
      const token = makeReceiptToken(ID, SECRET)!;
      for (let i = 0; i < token.length; i += 1) {
        if (token[i] === '.') continue;
        const swapped = token[i] === 'A' ? 'B' : 'A';
        expect(readReceiptToken(token.slice(0, i) + swapped + token.slice(i + 1), SECRET)).toBeNull();
      }
    });

    it('fails with another payment\'s id swapped in, since the signature is for the first one', () => {
      const [, sig] = makeReceiptToken(ID, SECRET)!.split('.');
      const [otherIdPart] = makeReceiptToken(OTHER_ID, SECRET)!.split('.');
      expect(readReceiptToken(`${otherIdPart}.${sig}`, SECRET)).toBeNull();
    });

    it('fails under a different secret', () => {
      const token = makeReceiptToken(ID, SECRET)!;
      expect(readReceiptToken(token, 'receipt-link:another-secret-entirely-0000')).toBeNull();
    });

    it('fails for anything that is not a token', () => {
      for (const bad of [undefined, null, 42, {}, [], '', 'abc', 'a.b', `${'x'.repeat(22)}.${'y'.repeat(22)}`, `${'x'.repeat(22)}.${'y'.repeat(22)}.z`, `${'!'.repeat(22)}.${'!'.repeat(22)}`, 'x'.repeat(45)]) {
        expect(readReceiptToken(bad, SECRET)).toBeNull();
      }
    });

    it('is not made for a value that is not a payment id', () => {
      for (const bad of ['', 'abc', '12345', `${ID}0`, 'g'.repeat(36), '../etc/passwd']) expect(makeReceiptToken(bad, SECRET)).toBeNull();
    });
  });

  describe('secret', () => {
    it('is its own setting first, then a key the server already holds', () => {
      expect(receiptSecret({ RECEIPT_LINK_SECRET: 'r'.repeat(20), SETTINGS_ENCRYPTION_KEY: 's'.repeat(20), JWT_ACCESS_SECRET: 'j'.repeat(20) } as never)).toBe(`receipt-link:${'r'.repeat(20)}`);
      expect(receiptSecret({ SETTINGS_ENCRYPTION_KEY: 's'.repeat(20), JWT_ACCESS_SECRET: 'j'.repeat(20) } as never)).toBe(`receipt-link:${'s'.repeat(20)}`);
      expect(receiptSecret({ JWT_ACCESS_SECRET: 'j'.repeat(20) } as never)).toBe(`receipt-link:${'j'.repeat(20)}`);
    });
    it('is null when there is nothing usable, rather than a guessable default', () => {
      expect(receiptSecret({} as never)).toBeNull();
      expect(receiptSecret({ RECEIPT_LINK_SECRET: 'short' } as never)).toBeNull();
    });
  });

  describe('url', () => {
    const env = { RECEIPT_LINK_SECRET: 'r'.repeat(20) } as never;
    it('points at the public receipt page with the token', () => {
      const url = receiptUrl(ID, env)!;
      expect(url.startsWith(`${DEFAULT_PUBLIC_API_URL}/api/v1/public/receipts/`)).toBe(true);
      const token = url.split('/').pop()!;
      expect(readReceiptToken(token, receiptSecret(env)!)).toBe(ID);
    });
    it('uses the configured public address, without doubling a trailing slash', () => {
      const url = receiptUrl(ID, { RECEIPT_LINK_SECRET: 'r'.repeat(20), PUBLIC_API_URL: 'https://api.example.org///' } as never)!;
      expect(url.startsWith('https://api.example.org/api/v1/public/receipts/')).toBe(true);
    });
    it('is null with no secret, or for something that is not a payment id', () => {
      expect(receiptUrl(ID, {} as never)).toBeNull();
      expect(receiptUrl('not-an-id', env)).toBeNull();
    });
  });

  it('gives a receipt number people can quote', () => {
    expect(receiptNumber(ID)).toBe('RCT-3F9C2A1E');
  });
});
