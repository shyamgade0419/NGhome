import * as http from 'http';
import { AddressInfo } from 'net';
import { createHmac } from 'crypto';
import {
  KEY_ID_PATTERN, RazorpayError, callbackIsSigned, checkKeys, createPaymentLink, fetchPaymentLink, fromPaise, modeOf, toPaise,
} from './razorpay';
import { renderReturnHtml } from './return-page';

describe('money in paise', () => {
  it('turns rupees into whole paise exactly', () => {
    expect(toPaise('1')).toBe(100);
    expect(toPaise('1234.56')).toBe(123456);
    expect(toPaise(2500)).toBe(250000);
    expect(toPaise('0.1')).toBe(10);
    expect(toPaise('19.99')).toBe(1999); // 19.99 * 100 is 1998.9999999999998 in floating point
    expect(toPaise({ toString: () => '75.50' })).toBe(7550); // a Prisma Decimal
  });

  it('refuses anything that is not a positive amount to the paisa', () => {
    for (const bad of ['0', '0.00', '-5', 'abc', '', '1.234', '1e3', ' ', '12,000']) expect(() => toPaise(bad)).toThrow(RangeError);
  });

  it('writes paise back as rupees', () => {
    expect(fromPaise(123456)).toBe('1234.56');
    expect(fromPaise(100)).toBe('1.00');
  });
});

describe('the keys', () => {
  it('recognises a Razorpay key id and whether it is test or live', () => {
    expect(KEY_ID_PATTERN.test('rzp_test_AbCdEfGh12345')).toBe(true);
    expect(KEY_ID_PATTERN.test('rzp_live_AbCdEfGh12345')).toBe(true);
    expect(KEY_ID_PATTERN.test('rzp_prod_AbCdEfGh12345')).toBe(false);
    expect(KEY_ID_PATTERN.test('AbCdEfGh12345')).toBe(false);
    expect(modeOf('rzp_live_AbCdEfGh12345')).toBe('LIVE');
    expect(modeOf('rzp_test_AbCdEfGh12345')).toBe('TEST');
  });
});

describe('the signed callback from the payment page', () => {
  const secret = 'a-razorpay-key-secret';
  const q = { razorpay_payment_id: 'pay_1', razorpay_payment_link_id: 'plink_1', razorpay_payment_link_reference_id: 'order-1', razorpay_payment_link_status: 'paid' };
  const sign = (s: string, p = q) => createHmac('sha256', s).update(`${p.razorpay_payment_link_id}|${p.razorpay_payment_link_reference_id}|${p.razorpay_payment_link_status}|${p.razorpay_payment_id}`).digest('hex');

  it('is accepted only when signed with the society\'s own secret', () => {
    expect(callbackIsSigned({ ...q, razorpay_signature: sign(secret) }, secret)).toBe(true);
    expect(callbackIsSigned({ ...q, razorpay_signature: sign('someone-elses-secret') }, secret)).toBe(false);
  });

  it('is refused when anything in it was changed or left out', () => {
    const sig = sign(secret);
    expect(callbackIsSigned({ ...q, razorpay_payment_id: 'pay_2', razorpay_signature: sig }, secret)).toBe(false);
    expect(callbackIsSigned({ ...q, razorpay_payment_link_status: 'created', razorpay_signature: sig }, secret)).toBe(false);
    expect(callbackIsSigned({ ...q, razorpay_signature: sig.slice(0, -1) }, secret)).toBe(false);
    expect(callbackIsSigned({ ...q }, secret)).toBe(false);
    expect(callbackIsSigned({ razorpay_signature: sig }, secret)).toBe(false);
  });
});

describe('the Razorpay client', () => {
  let server: http.Server;
  let seen: { method: string; url: string; auth?: string; body: any }[];
  let reply: { status: number; json: unknown };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
        res.writeHead(reply.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply.json));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env.RAZORPAY_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    delete process.env.RAZORPAY_API_BASE;
    await new Promise((r) => server.close(r));
  });
  beforeEach(() => {
    seen = [];
    reply = { status: 200, json: {} };
  });

  const creds = { keyId: 'rzp_test_AbCdEfGh12345', keySecret: 'secret-secret-1' };

  it('signs every call with the society\'s own key and secret', async () => {
    await checkKeys(creds);
    expect(seen[0].auth).toBe(`Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64')}`);
    expect(seen[0].url).toBe('/v1/payment_links?count=1');
  });

  it('makes a payment link for exactly the amount, once, with our own reference and no messages sent to the person', async () => {
    reply = { status: 200, json: { id: 'plink_9', short_url: 'https://rzp.io/i/abc' } };
    const link = await createPaymentLink(creds, {
      amountPaise: 150000, referenceId: 'order-uuid', description: 'Maintenance — invoice INV-1', customerName: 'Asha Rao', customerPhone: '9876543210',
      callbackUrl: 'https://api.example/api/v1/public/online-payments/return', expireBy: 1_900_000_000,
    });
    expect(link).toEqual({ id: 'plink_9', url: 'https://rzp.io/i/abc' });
    expect(seen[0].method).toBe('POST');
    expect(seen[0].body).toMatchObject({
      amount: 150000, currency: 'INR', accept_partial: false, reference_id: 'order-uuid', callback_url: 'https://api.example/api/v1/public/online-payments/return',
      callback_method: 'get', expire_by: 1_900_000_000, notify: { sms: false, email: false }, reminder_enable: false, customer: { name: 'Asha Rao', contact: '+919876543210' },
    });
  });

  it('reads a link back, with its payments', async () => {
    reply = { status: 200, json: { id: 'plink_9', status: 'paid', amount: 150000, amount_paid: 150000, reference_id: 'order-uuid', payments: [{ payment_id: 'pay_1', amount: 150000, status: 'captured' }] } };
    expect(await fetchPaymentLink(creds, 'plink_9')).toEqual({
      id: 'plink_9', status: 'paid', amountPaise: 150000, amountPaidPaise: 150000, referenceId: 'order-uuid', payments: [{ paymentId: 'pay_1', amountPaise: 150000, status: 'captured' }],
    });
    reply = { status: 200, json: { id: 'plink_9', status: 'created', amount: 150000, amount_paid: 0, payments: null } };
    expect((await fetchPaymentLink(creds, 'plink_9')).payments).toEqual([]);
  });

  it('says in plain words when the keys are refused, and in Razorpay\'s own words for anything else', async () => {
    reply = { status: 401, json: { error: { description: 'Authentication failed' } } };
    await expect(checkKeys(creds)).rejects.toThrow(/did not accept these keys/);
    reply = { status: 400, json: { error: { description: 'Payment links are not enabled for this account' } } };
    await expect(checkKeys(creds)).rejects.toThrow('Payment links are not enabled for this account');
  });

  it('says so when Razorpay cannot be reached at all', async () => {
    const saved = process.env.RAZORPAY_API_BASE;
    process.env.RAZORPAY_API_BASE = 'http://127.0.0.1:1';
    try {
      const err = await checkKeys(creds).catch((e) => e);
      expect(err).toBeInstanceOf(RazorpayError);
      expect((err as RazorpayError).unreachable).toBe(true);
    } finally {
      process.env.RAZORPAY_API_BASE = saved;
    }
  });
});

describe('the page after paying', () => {
  it('says the payment was received, with the amount', () => {
    const html = renderReturnHtml('PAID', '1500.00');
    expect(html).toContain('Payment received');
    expect(html).toContain('₹1,500');
    expect(html).not.toContain('<script');
  });

  it('is calm when it cannot tell, and clear when a payment expired or failed', () => {
    expect(renderReturnHtml('UNKNOWN', null)).toContain('We are confirming your payment');
    expect(renderReturnHtml('EXPIRED', '100')).toContain('expired');
    expect(renderReturnHtml('FAILED', '100')).toContain('did not go through');
    expect(renderReturnHtml('NEEDS_REVIEW', '100')).toContain('confirm it against your bill');
  });

  it('never puts anything from the address into the page unescaped', () => {
    expect(renderReturnHtml('PAID', '<img src=x onerror=alert(1)>')).not.toContain('<img');
  });
});
