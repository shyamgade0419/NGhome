/**
 * Online payments through a society's OWN Razorpay account, end to end on a real database with a fake Razorpay.
 * Covers connecting the account (checked with Razorpay, secret never returned), starting a payment for one's own bill,
 * "paid" being read from Razorpay and applied exactly once however many times it is asked, the signed return page,
 * the background pass for a person who paid and never came back, and money that cannot be applied being kept for a person.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Prisma, ResidencyType, SystemRole } from '@prisma/client';
import * as argon2 from 'argon2';
import * as http from 'http';
import { AddressInfo } from 'net';
import { createHmac } from 'crypto';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OnlinePaymentsService } from '../src/online-payments/online-payments.service';
import { PaymentsService } from '../src/payments/payments.service';

jest.setTimeout(120_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const RUN = String(Math.floor(10000 + Math.random() * 89999));
const phone = (n: number) => '8' + RUN + String(n).padStart(4, '0');
const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));
const D = (n: number | string) => new Prisma.Decimal(n);

const KEY_ID = 'rzp_test_AbCdEfGh12345';
const KEY_SECRET = 'a-razorpay-secret-for-tests';

/** A Razorpay that knows one set of keys and keeps the payment links it is asked for. */
function fakeRazorpay() {
  const state = {
    created: [] as any[],
    links: new Map<string, { id: string; status: string; amount: number; amount_paid: number; reference_id: string; payments: any[] | null }>(),
    down: false,
  };
  let n = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (status: number, json: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
      if (state.down) return send(500, { error: { description: 'Razorpay is having a bad day' } });
      const ok = req.headers.authorization === `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`;
      if (!ok) return send(401, { error: { description: 'Authentication failed' } });
      const url = req.url ?? '';
      if (req.method === 'GET' && url.startsWith('/v1/payment_links?')) return send(200, { payment_links: [] });
      if (req.method === 'POST' && url === '/v1/payment_links') {
        const body = JSON.parse(raw);
        state.created.push(body);
        n += 1;
        const id = `plink_${UNIQUE}_${n}`;
        state.links.set(id, { id, status: 'created', amount: body.amount, amount_paid: 0, reference_id: body.reference_id, payments: null });
        return send(200, { id, short_url: `https://rzp.io/i/${id}`, status: 'created' });
      }
      const m = url.match(/^\/v1\/payment_links\/([^/?]+)$/);
      if (req.method === 'GET' && m) {
        const link = state.links.get(decodeURIComponent(m[1]));
        return link ? send(200, link) : send(404, { error: { description: 'The id provided does not exist' } });
      }
      return send(404, { error: { description: 'not found' } });
    });
  });
  const pay = (linkId: string, paymentId: string, paise?: number) => {
    const l = state.links.get(linkId)!;
    l.status = 'paid';
    l.amount_paid = paise ?? l.amount;
    l.payments = [{ payment_id: paymentId, amount: paise ?? l.amount, status: 'captured' }];
  };
  const expire = (linkId: string) => { state.links.get(linkId)!.status = 'expired'; };
  return { server, state, pay, expire };
}

describe('Online payments (e2e, real Postgres, fake Razorpay)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let online: OnlinePaymentsService;
  let payments: PaymentsService;
  const rz = fakeRazorpay();
  const http_ = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let accountant: string;
  let societyId: string;
  let buildingId: string;
  let accountId: string;
  let personNo = 0;
  let flatNo = 0;
  let invNo = 0;
  let monthNo = 0;

  async function addPerson(flatId: string | null, role: SystemRole, over: { phone?: string | null } = {}) {
    personNo += 1;
    const email = `op${personNo}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: {
        email, firstName: `Person${personNo}`, lastName: 'Test', phone: over.phone === undefined ? phone(personNo) : over.phone,
        passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true,
      },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId, role, residencyType: ResidencyType.OWNER, status: 'ACTIVE', isPrimary: true } });
    const token = (await http_().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200)).body.data.accessToken as string;
    return { userId: user.id, token };
  }

  async function newFlat() {
    flatNo += 1;
    return (await http_().post('/api/v1/flats').set(auth(admin)).send({ buildingId, unitNumber: `${flatNo}`, flatCode: `OP-${flatNo}` }).expect(201)).body.data.id as string;
  }

  async function newBill(flatId: string, amount: number, published = true) {
    monthNo += 1;
    invNo += 1;
    const year = 2046 + Math.floor((monthNo - 1) / 12);
    const m = ((monthNo - 1) % 12) + 1;
    const mm = String(m).padStart(2, '0');
    const periodId = (await http_().post('/api/v1/billing/periods').set(auth(admin)).send({
      periodYear: year, periodMonth: m, startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-28`, dueDate: `${year}-${mm}-10`,
    }).expect(201)).body.data.id as string;
    await prisma.billingPeriod.update({ where: { id: periodId }, data: { status: 'PUBLISHED' } });
    return prisma.maintenanceBill.create({
      data: {
        societyId, billingPeriodId: periodId, flatId, invoiceNumber: `INV-OP-${UNIQUE}-${invNo}`, flatCode: `OP-${flatNo}`,
        baseAmount: D(amount), totalAmount: D(amount), pendingAmount: D(amount), dueDate: new Date(), isPublished: published,
      },
    });
  }

  const connect = (body: Record<string, unknown> = {}, token = admin) =>
    http_().put('/api/v1/online-payments/config').set(auth(token)).send({ keyId: KEY_ID, keySecret: KEY_SECRET, settlementAccountId: accountId, enabled: true, ...body });
  const start = (token: string, billId: string, amount: number | string) =>
    http_().post('/api/v1/online-payments/start').set(auth(token)).send({ maintenanceBillId: billId, amount: String(amount) });
  const statusOf = (token: string, id: string) => http_().get(`/api/v1/online-payments/${id}/status`).set(auth(token));
  const linkOf = async (orderId: string) => (await prisma.gatewayOrder.findUniqueOrThrow({ where: { id: orderId } })).providerLinkId!;
  const balance = async () => Number((await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalance);
  const signed = (linkId: string, orderId: string, payId: string, status = 'paid', secret = KEY_SECRET) => ({
    razorpay_payment_id: payId,
    razorpay_payment_link_id: linkId,
    razorpay_payment_link_reference_id: orderId,
    razorpay_payment_link_status: status,
    razorpay_signature: createHmac('sha256', secret).update(`${linkId}|${orderId}|${status}|${payId}`).digest('hex'),
  });

  beforeAll(async () => {
    await new Promise<void>((r) => rz.server.listen(0, '127.0.0.1', r));
    process.env.RAZORPAY_API_BASE = `http://127.0.0.1:${(rz.server.address() as AddressInfo).port}`;

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    online = moduleFixture.get(OnlinePaymentsService);
    payments = moduleFixture.get(PaymentsService);

    const reg = await http_().post('/api/v1/auth/register-society').send({
      society: { name: `E2E Online ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-op-${UNIQUE}@test.example`, contactPhone: '94' + String(UNIQUE).slice(-7) + '3' },
      admin: { firstName: 'Admin', lastName: 'OP', email: `admin-op-${UNIQUE}@test.example`, phone: '94' + String(UNIQUE).slice(-7) + '3', password: PASSWORD },
    }).expect(201);
    admin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    buildingId = (await http_().post('/api/v1/buildings').set(auth(admin)).send({ name: 'O', code: 'O' }).expect(201)).body.data.id;
    accountId = (await prisma.account.create({ data: { societyId, name: 'Main', accountType: 'CURRENT' } })).id;
    accountant = (await addPerson(null, SystemRole.SOCIETY_ACCOUNTANT)).token;
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
    await new Promise((r) => rz.server.close(r));
    delete process.env.RAZORPAY_API_BASE;
  });

  describe('connecting the society\'s own account', () => {
    it('refuses a Key ID that is not Razorpay\'s shape, and keys Razorpay does not accept, in plain words', async () => {
      expect(messageOf((await connect({ keyId: 'not-a-key' }).expect(400)).body)).toMatch(/Key ID/);
      const bad = await connect({ keySecret: 'definitely-the-wrong-secret' }).expect(400);
      expect(messageOf(bad.body)).toMatch(/did not accept these keys/);
      expect(await prisma.societyPaymentGateway.count({ where: { societyId } })).toBe(0);
    });

    it('needs the secret the first time, and an account of this society to credit', async () => {
      expect(messageOf((await connect({ keySecret: undefined }).expect(400)).body)).toMatch(/Key Secret/);
      expect(messageOf((await connect({ settlementAccountId: '00000000-0000-4000-8000-000000000000' }).expect(400)).body)).toMatch(/account/);
    });

    it('is for the admin only; the accountant can look but not change it, and a resident can do neither', async () => {
      const resident = (await addPerson(await newFlat(), SystemRole.RESIDENT)).token;
      await connect({}, accountant).expect(403);
      await connect({}, resident).expect(403);
      await http_().get('/api/v1/online-payments/config').set(auth(resident)).expect(403);
      await http_().get('/api/v1/online-payments/config').set(auth(accountant)).expect(200);
    });

    it('saves it after checking with Razorpay, encrypted, and never sends the secret back', async () => {
      const res = (await connect({ enabled: false }).expect(200)).body.data;
      expect(res).toMatchObject({ connected: true, enabled: false, provider: 'RAZORPAY', keyId: KEY_ID, mode: 'TEST', settlementAccount: { id: accountId, name: 'Main' }, problem: null });
      expect(JSON.stringify(res)).not.toContain(KEY_SECRET);
      const row = await prisma.societyPaymentGateway.findFirstOrThrow({ where: { societyId } });
      expect(row.keySecretEnc.startsWith('v1.')).toBe(true);
      expect(row.keySecretEnc).not.toContain(KEY_SECRET);
      expect(JSON.stringify(await prisma.auditLog.findMany({ where: { entityType: 'SocietyPaymentGateway' } }))).not.toContain(KEY_SECRET);
      // The saved secret is kept when it is left blank, and offering online payment is a separate switch.
      expect((await http_().get('/api/v1/online-payments/available').set(auth(admin)).expect(200)).body.data).toEqual({ enabled: false });
      const again = (await connect({ keySecret: '', enabled: true }).expect(200)).body.data;
      expect(again.enabled).toBe(true);
      expect((await http_().get('/api/v1/online-payments/available').set(auth(admin)).expect(200)).body.data).toEqual({ enabled: true });
    });

    it('does not keep the old secret for a different Key ID', async () => {
      expect(messageOf((await connect({ keyId: 'rzp_test_ZzZzZzZz98765', keySecret: '' }).expect(400)).body)).toMatch(/Key Secret/);
    });
  });

  describe('paying a bill from the app', () => {
    let residentToken: string;
    let flatId: string;
    let bill: Awaited<ReturnType<typeof newBill>>;

    beforeAll(async () => {
      flatId = await newFlat();
      residentToken = (await addPerson(flatId, SystemRole.RESIDENT, { phone: phone(900) })).token;
      bill = await newBill(flatId, 2000);
    });

    it('opens a Razorpay page for exactly the amount, for the resident\'s own bill only', async () => {
      const before = rz.state.created.length;
      const res = (await start(residentToken, bill.id, '1500.50').expect(201)).body.data;
      expect(res).toMatchObject({ outcome: 'WAITING', amount: '1500.5' });
      expect(res.url).toMatch(/^https:\/\/rzp\.io\/i\/plink_/);
      const sent = rz.state.created[before];
      expect(sent).toMatchObject({ amount: 150050, currency: 'INR', accept_partial: false, reference_id: res.id, notify: { sms: false, email: false }, customer: { contact: `+91${phone(900)}` } });
      expect(sent.callback_url).toMatch(/\/api\/v1\/public\/online-payments\/return$/);
      expect(sent.description).toContain(bill.invoiceNumber);
      // Nothing is paid until Razorpay says so.
      expect((await prisma.maintenanceBill.findUniqueOrThrow({ where: { id: bill.id } })).isPaid).toBe(false);
      expect(await prisma.paymentSubmission.count({ where: { flatId } })).toBe(0);
    });

    it('refuses another flat\'s bill, a bill not yet published, silly amounts, and more than a flat can pay', async () => {
      const otherFlat = await newFlat();
      const other = await newBill(otherFlat, 900);
      await start(residentToken, other.id, 500).expect(403);
      const draft = await newBill(flatId, 700, false);
      expect(messageOf((await start(residentToken, draft.id, 700).expect(400)).body)).toMatch(/not been published/);
      for (const amount of ['0', '-5', 'abc', '10.999']) await start(residentToken, bill.id, amount).expect(400);
      expect(messageOf((await start(residentToken, bill.id, 99999999).expect(400)).body)).toMatch(/more than this flat can pay/);
      await start(residentToken, '00000000-0000-4000-8000-000000000000', 100).expect(404);
    });

    it('is told nothing is paid while Razorpay says the page is open, then applies it once Razorpay says it was paid', async () => {
      const order = (await start(residentToken, bill.id, 2000).expect(201)).body.data;
      expect((await statusOf(residentToken, order.id).expect(200)).body.data.outcome).toBe('WAITING');

      const startBalance = await balance();
      rz.pay(await linkOf(order.id), `pay_${UNIQUE}_a`);
      const done = (await statusOf(residentToken, order.id).expect(200)).body.data;
      expect(done).toMatchObject({ outcome: 'PAID', amount: '2000' });

      const paid = await prisma.maintenanceBill.findUniqueOrThrow({ where: { id: bill.id } });
      expect(paid.isPaid).toBe(true);
      expect(Number(paid.pendingAmount)).toBe(0);
      expect(await balance()).toBe(startBalance + 2000);
      const payment = await prisma.paymentSubmission.findFirstOrThrow({ where: { flatId, utrNumber: `pay_${UNIQUE}_a` } });
      expect(payment).toMatchObject({ status: 'APPROVED', paymentMethod: 'UPI', referenceNumber: `pay_${UNIQUE}_a` });
      expect(Number(payment.amount)).toBe(2000);
      const tx = await prisma.transaction.findFirstOrThrow({ where: { linkedEntityId: payment.id } });
      expect(tx.description).toContain(`Online payment received — pay_${UNIQUE}_a`);
      expect((await prisma.gatewayOrder.findUniqueOrThrow({ where: { id: order.id } })).paymentSubmissionId).toBe(payment.id);
    });

    it('applies a payment only once, however many times and from however many places it is asked', async () => {
      const f = await newFlat();
      const tok = (await addPerson(f, SystemRole.RESIDENT)).token;
      const b = await newBill(f, 1000);
      const order = (await start(tok, b.id, 1000).expect(201)).body.data;
      const link = await linkOf(order.id);
      rz.pay(link, `pay_${UNIQUE}_once`);
      const startBalance = await balance();

      const results = await Promise.all([
        statusOf(tok, order.id), statusOf(tok, order.id), statusOf(tok, order.id),
        http_().get('/api/v1/public/online-payments/return').query(signed(link, order.id, `pay_${UNIQUE}_once`)),
        online.reconcile(),
      ]);
      expect(results.slice(0, 3).every((r: any) => r.status === 200 && r.body.data.outcome === 'PAID')).toBe(true);
      expect(await balance()).toBe(startBalance + 1000);
      expect(await prisma.paymentSubmission.count({ where: { flatId: f } })).toBe(1);
      expect(await prisma.transaction.count({ where: { linkedEntityType: 'PaymentSubmission', description: { contains: `pay_${UNIQUE}_once` } } })).toBe(1);
      expect(await online.reconcile()).toBe(0);
    });

    it('shows a returning person a page that says the payment was received, and acts only on a callback signed with the society\'s secret', async () => {
      const f = await newFlat();
      const tok = (await addPerson(f, SystemRole.RESIDENT)).token;
      const b = await newBill(f, 800);
      const order = (await start(tok, b.id, 800).expect(201)).body.data;
      const link = await linkOf(order.id);
      rz.pay(link, `pay_${UNIQUE}_ret`);

      // Signed with someone else's secret: a calm page, and nothing changes.
      const forged = await http_().get('/api/v1/public/online-payments/return').query(signed(link, order.id, `pay_${UNIQUE}_ret`, 'paid', 'not-the-secret')).expect(200);
      expect(forged.text).toContain('We are confirming your payment');
      expect((await prisma.gatewayOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CREATED');
      // Not a real order at all.
      const nonsense = await http_().get('/api/v1/public/online-payments/return').query({ razorpay_payment_link_reference_id: 'x' }).expect(200);
      expect(nonsense.text).toContain('We are confirming your payment');

      const real = await http_().get('/api/v1/public/online-payments/return').query(signed(link, order.id, `pay_${UNIQUE}_ret`)).expect(200);
      expect(real.text).toContain('Payment received');
      expect(real.headers['content-type']).toMatch(/text\/html/);
      expect(real.headers['content-security-policy']).toContain("default-src 'none'");
      expect((await prisma.gatewayOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
    });

    it('picks up a payment made in a UPI app by a person who never came back, in the background', async () => {
      const f = await newFlat();
      const tok = (await addPerson(f, SystemRole.RESIDENT)).token;
      const b = await newBill(f, 600);
      const order = (await start(tok, b.id, 600).expect(201)).body.data;
      rz.pay(await linkOf(order.id), `pay_${UNIQUE}_bg`);
      expect(await online.reconcile()).toBeGreaterThanOrEqual(1);
      expect((await prisma.maintenanceBill.findUniqueOrThrow({ where: { id: b.id } })).isPaid).toBe(true);
      expect((await statusOf(tok, order.id).expect(200)).body.data.outcome).toBe('PAID');
    });

    it('gives up on a page that expired, and keeps asking while Razorpay cannot be reached', async () => {
      const f = await newFlat();
      const tok = (await addPerson(f, SystemRole.RESIDENT)).token;
      const b = await newBill(f, 500);
      const expired = (await start(tok, b.id, 500).expect(201)).body.data;
      rz.expire(await linkOf(expired.id));
      expect((await statusOf(tok, expired.id).expect(200)).body.data.outcome).toBe('EXPIRED');

      const waiting = (await start(tok, b.id, 500).expect(201)).body.data;
      rz.state.down = true;
      try {
        expect((await statusOf(tok, waiting.id).expect(200)).body.data.outcome).toBe('WAITING');
      } finally {
        rz.state.down = false;
      }
      rz.pay(await linkOf(waiting.id), `pay_${UNIQUE}_late`);
      expect((await statusOf(tok, waiting.id).expect(200)).body.data.outcome).toBe('PAID');
    });

    it('lets nobody read another person\'s payment', async () => {
      const f = await newFlat();
      const mine = (await addPerson(f, SystemRole.RESIDENT)).token;
      const b = await newBill(f, 400);
      const order = (await start(mine, b.id, 400).expect(201)).body.data;
      const stranger = (await addPerson(await newFlat(), SystemRole.RESIDENT)).token;
      await statusOf(stranger, order.id).expect(404);
    });

    it('keeps money that cannot be applied automatically for a person, never dropping it', async () => {
      const f = await newFlat();
      const user = await addPerson(f, SystemRole.RESIDENT);
      const b = await newBill(f, 300);
      const out = await payments.recordOnline(societyId, { userId: user.userId, flatId: f, billId: b.id, amount: D(300), providerPaymentId: `pay_${UNIQUE}_stuck`, paidAt: new Date(), accountId: null });
      expect(out.applied).toBe(false);
      const row = await prisma.paymentSubmission.findUniqueOrThrow({ where: { id: out.payment.id } });
      expect(row.status).toBe('PENDING');
      expect(row.notes).toMatch(/could not be applied to the bill automatically/);
      expect(row.notes).toContain(`pay_${UNIQUE}_stuck`);
      // The same payment id arriving again returns that record instead of a second one.
      const again = await payments.recordOnline(societyId, { userId: user.userId, flatId: f, billId: b.id, amount: D(300), providerPaymentId: `pay_${UNIQUE}_stuck`, paidAt: new Date(), accountId });
      expect(again.payment.id).toBe(out.payment.id);
      expect((await prisma.maintenanceBill.findUniqueOrThrow({ where: { id: b.id } })).isPaid).toBe(false);
    });

    it('shows the admin how payments are going, and refuses to start one once it is switched off', async () => {
      const list = (await http_().get('/api/v1/online-payments/recent').set(auth(admin)).expect(200)).body.data;
      expect(list.length).toBeGreaterThan(3);
      expect(list.some((o: any) => o.outcome === 'PAID' && /^OP-\d+$/.test(o.flatCode))).toBe(true);

      await connect({ keySecret: '', enabled: false }).expect(200);
      expect(messageOf((await start(residentToken, bill.id, 100).expect(400)).body)).toMatch(/not switched on/);
      await connect({ keySecret: '', enabled: true }).expect(200);
    });

    it('forgets the keys on disconnect, and then offers nothing', async () => {
      const res = (await http_().delete('/api/v1/online-payments/config').set(auth(admin)).expect(200)).body.data;
      expect(res).toMatchObject({ connected: false, enabled: false, keyId: null });
      expect((await http_().get('/api/v1/online-payments/available').set(auth(admin)).expect(200)).body.data).toEqual({ enabled: false });
      expect(await prisma.societyPaymentGateway.count({ where: { societyId } })).toBe(0);
    });
  });
});
