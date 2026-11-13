import { fineMessage, noticeLead, noticeMessage, paidMessage, publishedMessage } from './whatsapp-messages';
import { GatewayError, readGatewayConfig, sendText, sessionStatus } from './openwa.client';
import {
  chatIdFor, cleanReminderDays, inSendWindow, istDayStart, istParts, normalizePhone, readWhatsappSettings,
} from './whatsapp-settings';

describe('phone numbers', () => {
  it('turns what people type into the digits WhatsApp wants', () => {
    expect(normalizePhone('98765 43210')).toBe('919876543210');
    expect(normalizePhone('+91 98765-43210')).toBe('919876543210');
    expect(normalizePhone('09876543210')).toBe('919876543210');
    expect(normalizePhone('919876543210')).toBe('919876543210');
  });
  it('keeps a foreign number that carries its country code', () => {
    expect(normalizePhone('+1 415 555 2671')).toBe('14155552671');
  });
  it('refuses what cannot be a real mobile number instead of guessing', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('5876543210')).toBeNull(); // an Indian mobile starts 6–9
    expect(normalizePhone('1234567890123456')).toBeNull();
  });
  it('builds the chat id', () => {
    expect(chatIdFor('919876543210')).toBe('919876543210@c.us');
  });
});

describe('the society\'s WhatsApp settings', () => {
  it('is off, with the 5th and 10th as reminder days, until the admin says otherwise', () => {
    expect(readWhatsappSettings(undefined)).toEqual({ enabled: false, notices: false, reminderDays: [5, 10] });
    expect(readWhatsappSettings({ whatsapp: { enabled: 'yes' } })).toEqual({ enabled: false, notices: false, reminderDays: [5, 10] });
  });
  it('reads what was saved, an empty list meaning no reminders', () => {
    expect(readWhatsappSettings({ whatsapp: { enabled: true, reminderDays: [3, 12] } })).toEqual({ enabled: true, notices: false, reminderDays: [3, 12] });
    expect(readWhatsappSettings({ whatsapp: { enabled: true, notices: true } }).notices).toBe(true);
    expect(readWhatsappSettings({ whatsapp: { enabled: true, notices: 'yes' } }).notices).toBe(false); // only a real true switches it on
    expect(readWhatsappSettings({ whatsapp: { enabled: true, reminderDays: [] } }).reminderDays).toEqual([]);
  });
  it('keeps reminder days to real days of every month, once each, in order', () => {
    expect(cleanReminderDays([10, 5, 5, 0, 29, 31, -1, 2.5, 'x'])).toEqual([5, 10]);
    expect(cleanReminderDays([1, 2, 3, 4, 5, 6, 7, 8])).toHaveLength(6);
    expect(cleanReminderDays('5')).toEqual([]);
  });
});

describe('the India calendar and the sending window', () => {
  it('reads the day and hour in India time, not the server\'s', () => {
    // 2026-11-04 19:00 UTC is 2026-11-05 00:30 in India.
    expect(istParts(new Date('2026-11-04T19:00:00Z'))).toEqual({ date: '2026-11-05', day: 5, hour: 0 });
    expect(istParts(new Date('2026-11-05T04:00:00Z'))).toEqual({ date: '2026-11-05', day: 5, hour: 9 });
  });
  it('only sends between 9 in the morning and 8 in the evening', () => {
    expect(inSendWindow(new Date('2026-11-05T03:00:00Z'))).toBe(false); // 08:30 IST
    expect(inSendWindow(new Date('2026-11-05T03:30:00Z'))).toBe(true); // 09:00 IST
    expect(inSendWindow(new Date('2026-11-05T14:00:00Z'))).toBe(true); // 19:30 IST
    expect(inSendWindow(new Date('2026-11-05T14:30:00Z'))).toBe(false); // 20:00 IST
    expect(inSendWindow(new Date('2026-11-05T20:00:00Z'))).toBe(false); // 01:30 IST
  });
  it('starts the India day at midnight India time', () => {
    expect(istDayStart(new Date('2026-11-05T10:00:00Z')).toISOString()).toBe('2026-11-04T18:30:00.000Z');
  });
});

describe('the messages', () => {
  it('say what a published bill is, and when it is due', () => {
    const m = publishedMessage({ name: 'Asha', flat: 'A-101', month: 'November 2026', pending: 3500, dueDate: '10 Nov 2026', society: 'Green Park' });
    expect(m).toContain('Dear Asha');
    expect(m).toContain('*November 2026*');
    expect(m).toContain('Flat *A-101*');
    expect(m).toContain('₹3,500');
    expect(m).toContain('10 Nov 2026');
  });
  it('say a fine was added and what is now due', () => {
    const m = fineMessage({ name: 'Asha', flat: 'A-101', month: 'November 2026', fee: 100, pending: '3600', society: 'Green Park' });
    expect(m).toContain('late fine of *₹100*');
    expect(m).toContain('₹3,600');
  });
  it('thank for a payment, and only mention a balance when one is left', () => {
    const full = paidMessage({ name: 'Asha', flat: 'A-101', amount: '3500', paidOn: '5 Nov 2026', balance: '0', society: 'Green Park' });
    expect(full).toContain('received *₹3,500*');
    expect(full).not.toContain('Balance still due');
    const part = paidMessage({ name: 'Asha', flat: 'A-101', amount: '1000', paidOn: '5 Nov 2026', balance: '2500', society: 'Green Park' });
    expect(part).toContain('Balance still due: *₹2,500*');
  });
  it('adds the receipt link to a payment confirmation when there is one, and leaves it out when there is not', () => {
    const url = 'https://nghome-api.novagade.in/api/v1/public/receipts/AbCdEfGhIjKlMnOpQrStUv.AbCdEfGhIjKlMnOpQrStUv';
    const withLink = paidMessage({ name: 'Asha', flat: 'A-101', amount: '3500', paidOn: '5 Nov 2026', balance: '0', society: 'Green Park', receiptUrl: url });
    expect(withLink).toContain('Your receipt:');
    expect(withLink).toContain(url);
    expect(withLink.indexOf(url)).toBeLessThan(withLink.indexOf('_Green Park_')); // before the society line
    const without = paidMessage({ name: 'Asha', flat: 'A-101', amount: '3500', paidOn: '5 Nov 2026', balance: '0', society: 'Green Park' });
    expect(without).not.toContain('receipt');
    expect(without).not.toContain('http');
  });
});

describe('the gateway client', () => {
  const cfg = { url: 'http://gw:2785', key: 'k', sessionId: 's1' };
  const reply = (status: number, body: unknown) => jest.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  it('is configured only when all three settings are present', () => {
    expect(readGatewayConfig({ WHATSAPP_API_URL: 'http://x/', WHATSAPP_API_KEY: 'k', WHATSAPP_SESSION_ID: 's' } as any)).toEqual({ url: 'http://x', key: 'k', sessionId: 's' });
    expect(readGatewayConfig({ WHATSAPP_API_URL: 'http://x', WHATSAPP_API_KEY: 'k' } as any)).toBeNull();
    expect(readGatewayConfig({} as any)).toBeNull();
  });

  it('sends the text with the key, the chat id and an idempotency key', async () => {
    const f = reply(201, { messageId: 'm1' });
    const out = await sendText(cfg, '919876543210@c.us', 'Hi', 'society:published:b1', f as any);
    expect(out.messageId).toBe('m1');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://gw:2785/api/sessions/s1/messages/send-text');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('k');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('society:published:b1');
    expect(JSON.parse(init.body as string)).toEqual({ chatId: '919876543210@c.us', text: 'Hi' });
  });

  it('treats a refused key, a session that is not ready and an unreachable gateway as "stop sending"', async () => {
    await expect(sendText(cfg, 'c', 't', 'k', reply(401, { message: 'bad key' }) as any)).rejects.toMatchObject({ gatewayDown: true });
    await expect(sendText(cfg, 'c', 't', 'k', reply(409, { message: 'Session not ready' }) as any)).rejects.toMatchObject({ gatewayDown: true });
    await expect(sendText(cfg, 'c', 't', 'k', reply(429, { message: 'slow down' }) as any)).rejects.toMatchObject({ gatewayDown: true });
    await expect(sendText(cfg, 'c', 't', 'k', (async () => { throw new Error('ECONNREFUSED'); }) as any)).rejects.toMatchObject({ gatewayDown: true });
  });

  it('gives up for good on a number WhatsApp does not know, but retries other refusals', async () => {
    await expect(sendText(cfg, 'c', 't', 'k', reply(400, { message: 'The number is not registered on WhatsApp' }) as any)).rejects.toMatchObject({ permanent: true, gatewayDown: false });
    await expect(sendText(cfg, 'c', 't', 'k', reply(500, { message: 'boom' }) as any)).rejects.toMatchObject({ permanent: false, gatewayDown: false });
    await expect(sendText(cfg, 'c', 't', 'k', reply(500, { message: 'boom' }) as any)).rejects.toBeInstanceOf(GatewayError);
  });

  it('reads the session state, whether or not the gateway wraps it in data', async () => {
    expect(await sessionStatus(cfg, reply(200, { id: 's1', status: 'ready', phone: '919000000000' }) as any)).toEqual({ status: 'ready', phone: '919000000000' });
    expect(await sessionStatus(cfg, reply(200, { data: { status: 'qr_ready' } }) as any)).toEqual({ status: 'qr_ready', phone: null });
    await expect(sessionStatus(cfg, reply(404, { message: 'no such session' }) as any)).rejects.toMatchObject({ gatewayDown: true });
  });
  it('say what happened to a meeting or an event, in the first line', () => {
    expect(noticeLead('MEETING', 'NEW')).toBe('a society meeting has been scheduled');
    expect(noticeLead('EVENT', 'NEW')).toBe('a new society event has been planned');
    expect(noticeLead('MEETING', 'REMINDER')).toContain('is tomorrow');
    expect(noticeLead('EVENT', 'MOVED')).toContain('moved');
    expect(noticeLead('EVENT', 'CANCELLED')).toContain('cancelled');
  });
  it('tell a flat when and where, and leave out a place or details there are none of', () => {
    const full = noticeMessage({ name: 'Asha', type: 'MEETING', stage: 'NEW', title: 'Annual General Meeting', when: 'Sat, 14 Nov, 6:00 pm', where: 'Clubhouse', details: 'Budget and repairs', society: 'Green Park' });
    expect(full).toContain('Dear Asha');
    expect(full).toContain('A society meeting has been scheduled:');
    expect(full).toContain('*Annual General Meeting*');
    expect(full).toContain('Sat, 14 Nov, 6:00 pm');
    expect(full).toContain('Clubhouse');
    expect(full).toContain('Budget and repairs');
    const bare = noticeMessage({ name: 'Asha', type: 'EVENT', stage: 'CANCELLED', title: 'Diwali', when: 'Sat, 14 Nov, 6:00 pm', where: '  ', details: null, society: 'Green Park' });
    expect(bare).not.toContain('📍');
    expect(bare).toContain('A society event has been cancelled:');
  });
});
