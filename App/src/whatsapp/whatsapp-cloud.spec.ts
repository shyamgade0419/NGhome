import { CLOUD_TEMPLATES, cleanParam, isOptionalTemplate, orderedParams, renderTemplate, templateOf } from './whatsapp-cloud-templates';
import { cloudError, listTemplates, sendTemplate } from './whatsapp-cloud.client';

const blanks = (text: string) => [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));

describe('the WhatsApp message templates (what Meta is asked to approve)', () => {
  it.each(CLOUD_TEMPLATES)('$name follows Meta\'s rules', (t) => {
    expect(t.name).toMatch(/^[a-z0-9_]+$/);
    // Blanks are numbered 1..n in order, each with a named value and an example.
    expect(blanks(t.text)).toEqual(t.params.map((_, i) => i + 1));
    expect(t.samples).toHaveLength(t.params.length);
    // Meta refuses a template that starts or ends with a blank.
    expect(t.text).not.toMatch(/^\{\{/);
    expect(t.text).not.toMatch(/\}\}[.!?]?$/);
  });

  it('has one template for each automatic message, and none for a test', () => {
    expect(CLOUD_TEMPLATES.map((t) => t.kind).sort()).toEqual(['BILL_PUBLISHED', 'FINE_IMPOSED', 'PAYMENT_RECEIPT', 'PAYMENT_RECEIVED', 'REMINDER', 'REMINDER_FINAL']);
    expect(templateOf('TEST')).toBeUndefined();
  });

  it('needs only the four main templates to send: the receipt one and the follow-up reminder are optional and never hold a society up', () => {
    expect(CLOUD_TEMPLATES.filter((t) => !t.optional).map((t) => t.kind).sort()).toEqual(['BILL_PUBLISHED', 'FINE_IMPOSED', 'PAYMENT_RECEIVED', 'REMINDER']);
    expect(isOptionalTemplate('PAYMENT_RECEIPT')).toBe(true);
    expect(isOptionalTemplate('REMINDER_FINAL')).toBe(true);
    expect(isOptionalTemplate('REMINDER')).toBe(false);
    expect(isOptionalTemplate('PAYMENT_RECEIVED')).toBe(false);
    expect(isOptionalTemplate('NOPE')).toBe(false);
  });

  it('has template names that are all different, as Meta requires', () => {
    const names = CLOUD_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z0-9_]+$/);
  });

  it('has a follow-up reminder that fills in like the first and says it is a second one', () => {
    const first = templateOf('REMINDER')!;
    const second = templateOf('REMINDER_FINAL')!;
    expect(second.params).toEqual(first.params); // the same details, so one set of values fills either
    const values = { name: 'Ravi', flat: 'A-101', month: 'Nov 2026', amount: '2,500', dueDate: '10 Nov 2026', society: 'Sunrise' };
    expect(orderedParams(second, values)).toEqual(orderedParams(first, values));
    expect(renderTemplate(second, values)).toContain('second reminder');
    expect(renderTemplate(first, values)).not.toContain('second reminder');
  });

  it('puts the receipt link into the confirmation that carries it, after the amounts and before the society', () => {
    const t = templateOf('PAYMENT_RECEIPT')!;
    const values = { name: 'Ravi', amount: '2,500', flat: 'A-101', paidOn: '8 Nov 2026', balance: '0', receipt: 'https://x.example/r/abc.def', society: 'Sunrise' };
    expect(orderedParams(t, values)).toEqual(['Ravi', '2,500', 'A-101', '8 Nov 2026', '0', 'https://x.example/r/abc.def', 'Sunrise']);
    expect(renderTemplate(t, values)).toBe('Hello Ravi, we have received ₹2,500 for Flat A-101 on 8 Nov 2026. Thank you! Balance still due: ₹0. Your receipt is here: https://x.example/r/abc.def - sent on behalf of Sunrise via NG Home.');
  });

  it('fills the blanks in the template\'s order, whatever order the values arrive in', () => {
    const t = templateOf('PAYMENT_RECEIVED')!;
    const values = { society: 'Sunrise', balance: '0', paidOn: '8 Nov 2026', flat: 'A-101', amount: '2,500', name: 'Ravi' };
    expect(orderedParams(t, values)).toEqual(['Ravi', '2,500', 'A-101', '8 Nov 2026', '0', 'Sunrise']);
    expect(renderTemplate(t, values)).toBe('Hello Ravi, we have received ₹2,500 for Flat A-101 on 8 Nov 2026. Thank you! Balance still due: ₹0. Sent on behalf of Sunrise via NG Home.');
  });

  it('cleans a value into something Meta accepts: one line, no tabs, never empty', () => {
    expect(cleanParam('Ravi\nKumar\t Jr')).toBe('Ravi Kumar  Jr');
    expect(cleanParam('a        b')).toBe('a   b');
    expect(cleanParam('   ')).toBe('-');
    expect(cleanParam(undefined)).toBe('-');
    expect(cleanParam('x'.repeat(2000))).toHaveLength(1024);
  });
});

describe('what Meta\'s errors mean for the sender', () => {
  const err = (code: number, status = 400) => cloudError(status, { error: { code, message: `m${code}` } });

  it('holds the society (not the message) when the token, the account or a template is the problem', () => {
    for (const code of [190, 102, 10, 200, 131042, 131031, 133010, 132001, 132000, 130429, 131048, 80007]) {
      const e = err(code);
      expect({ code, down: e.gatewayDown, society: e.societyOnly, permanent: e.permanent }).toEqual({ code, down: true, society: true, permanent: false });
    }
    expect(cloudError(401, null).societyOnly).toBe(true);
    expect(cloudError(429, null).societyOnly).toBe(true);
  });

  it('gives up on a message that can never be delivered', () => {
    for (const code of [131026, 131030, 131021, 131049]) {
      const e = err(code);
      expect({ code, down: e.gatewayDown, permanent: e.permanent }).toEqual({ code, down: false, permanent: true });
    }
  });

  it('retries anything else a few times', () => {
    const e = cloudError(500, { error: { code: 2, message: 'Service temporarily unavailable' } });
    expect({ down: e.gatewayDown, permanent: e.permanent }).toEqual({ down: false, permanent: false });
  });

  it('says what Meta said, preferring its plain-language text', () => {
    const e = cloudError(400, { error: { code: 131030, message: 'raw', error_data: { details: 'Recipient phone number not in allowed list' } } });
    expect(e.message).toBe('Recipient phone number not in allowed list');
    expect(cloudError(400, { error: { code: 1, message: 'raw', error_user_msg: 'Friendly' } }).message).toBe('Friendly');
  });
});

describe('talking to Meta', () => {
  const creds = { phoneNumberId: '111', accessToken: 'tok', wabaId: '222' };
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('sends a template with the blanks as text parameters, using the society\'s own id and token', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await sendTemplate(creds, '919876543210', { name: 'ng_late_fine', language: 'en' }, ['Ravi', 'Nov 2026'], fake);
    expect(out.messageId).toBe('wamid.1');
    expect(seen?.url).toMatch(/\/111\/messages$/);
    expect((seen?.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(seen?.init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '919876543210',
      type: 'template',
      template: { name: 'ng_late_fine', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ravi' }, { type: 'text', text: 'Nov 2026' }] }] },
    });
  });

  it('sends a template with no blanks (hello_world) without a components list', async () => {
    let body: any;
    const fake = (async (_u: string, init: RequestInit) => { body = JSON.parse(init.body as string); return new Response('{"messages":[{"id":"x"}]}', { status: 200 }); }) as unknown as typeof fetch;
    await sendTemplate(creds, '919876543210', { name: 'hello_world', language: 'en_US' }, [], fake);
    expect(body.template).toEqual({ name: 'hello_world', language: { code: 'en_US' } });
  });

  it('turns Meta\'s refusal into an error that says why', async () => {
    await expect(sendTemplate(creds, '91', { name: 'x', language: 'en' }, [], reply(401, { error: { code: 190, message: 'Invalid OAuth access token.' } }))).rejects.toMatchObject({ societyOnly: true });
  });

  it('lists only the templates in NG Home\'s language, and none without a business account id', async () => {
    const live = reply(200, { data: [
      { name: 'ng_late_fine', status: 'APPROVED', language: 'en' },
      { name: 'ng_late_fine', status: 'REJECTED', language: 'hi', rejected_reason: 'NONE' },
      { name: 'ng_bill_published', status: 'REJECTED', language: 'en', rejected_reason: 'INCORRECT_CATEGORY' },
    ] });
    expect(await listTemplates(creds, live)).toEqual([
      { name: 'ng_late_fine', status: 'APPROVED', rejectedReason: null },
      { name: 'ng_bill_published', status: 'REJECTED', rejectedReason: 'INCORRECT_CATEGORY' },
    ]);
    expect(await listTemplates({ phoneNumberId: '1', accessToken: 't' }, live)).toEqual([]);
  });
});
