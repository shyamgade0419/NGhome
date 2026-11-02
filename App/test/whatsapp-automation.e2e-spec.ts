/**
 * WhatsApp automation — against a REAL Postgres and a fake WhatsApp gateway (a local HTTP server standing in for OpenWA).
 *
 * What a fake cannot prove: each event (bill published, reminder, late fine, payment received) queues exactly one
 * message to the right person — the tenant when a flat has one, else the owner; nothing is sent while the society has
 * it switched off or the gateway is not connected; a retry cannot deliver twice; the sender is paced, capped, and
 * stops the moment WhatsApp is unusable; and a failing send can never fail a bill, a payment or a login.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Prisma, ResidencyType, SystemRole } from '@prisma/client';
import * as argon2 from 'argon2';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { LateFeeService } from '../src/billing/late-fee.service';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { WhatsappSettingsStore } from '../src/whatsapp/whatsapp-settings.store';
import { CLOUD_TEMPLATES } from '../src/whatsapp/whatsapp-cloud-templates';

jest.setTimeout(120_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const adminPhone = () => '94' + String(UNIQUE).slice(-7) + '1';
/** Different on every run, so a database that kept an earlier run's users does not collide. */
const RUN = String(Math.floor(10000 + Math.random() * 89999));
const mobile = (n: number) => '8' + RUN + String(n).padStart(4, '0'); // 10 digits, starts 8 — a valid Indian mobile
const autoPhone = (n: number) => '7' + RUN + String(n).padStart(4, '0'); // for people whose number does not matter
const wa = (n: number) => '91' + mobile(n);
const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));
const D = (n: number | string) => new Prisma.Decimal(n);

/** A stand-in for OpenWA: records what it is asked to send and can be told to misbehave. */
function fakeGateway() {
  const state = {
    // sess-1 belongs to the main test society; `session` is its state. Other sessions (one per other society) live in `others`.
    session: 'ready',
    others: {} as Record<string, { status: string; phone: string }>,
    sendStatus: 201 as number,
    sendMessage: 'ok',
    sent: [] as { session: string; chatId: string; text: string; key: string; apiKey: string }[],
    attempts: 0,
  };
  const lookup = (id: string) => (id === 'sess-1' ? { status: state.session, phone: '919000011111' } : (state.others[id] ?? null));
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      const url = req.url ?? '';
      const one = /^\/api\/sessions\/([^/]+)$/.exec(url);
      if (req.method === 'GET' && one) {
        const sess = lookup(one[1]);
        return sess ? send(200, { id: one[1], ...sess }) : send(404, { message: 'Session not found' });
      }
      const sendText = /^\/api\/sessions\/([^/]+)\/messages\/send-text$/.exec(url);
      if (req.method === 'POST' && sendText) {
        state.attempts += 1;
        const sess = lookup(sendText[1]);
        if (!sess) return send(404, { message: 'Session not found' });
        if (state.sendStatus !== 201) return send(state.sendStatus, { message: state.sendMessage });
        if (sendText[1] !== 'sess-1' && sess.status !== 'ready') return send(409, { message: 'Session not ready' });
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        state.sent.push({ session: sendText[1], chatId: body.chatId, text: body.text, key: String(req.headers['idempotency-key']), apiKey: String(req.headers['x-api-key']) });
        return send(201, { messageId: `m${state.sent.length}` });
      }
      send(404, { message: 'no such route' });
    });
  });
  return { state, server };
}

describe('WhatsApp automation (e2e, real Postgres, fake gateway)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let whatsapp: WhatsappService;
  let lateFees: LateFeeService;
  let store: WhatsappSettingsStore;
  const gw = fakeGateway();
  const http_ = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let accountant: string;
  let resident: string;
  let societyId: string;
  let buildingId: string;
  let accountId: string;
  let flatNo = 0;
  let monthNo = 0;
  let invNo = 0;
  let personNo = 0;

  const drain = (over: Parameters<WhatsappService['drain']>[0] = {}) => whatsapp.drain({ gap: () => 0, ignoreWindow: true, ...over });
  const rows = (where: Prisma.WhatsappMessageWhereInput = {}) => prisma.whatsappMessage.findMany({ where: { societyId, ...where }, orderBy: { createdAt: 'asc' } });
  const setConfig = (body: Record<string, unknown>) => http_().patch('/api/v1/societies/my/config').set(auth(admin)).send(body).expect(200);
  /** Earlier tests leave overdue bills in this society; the fine tests must only see their own. */
  const settleOthers = () => prisma.maintenanceBill.updateMany({ where: { societyId, isPaid: false }, data: { isPaid: true, pendingAmount: 0 } });
  // All societies, not just this one: the daily cap counts every message sent from the one WhatsApp number.
  const reset = async () => { await prisma.whatsappMessage.deleteMany({}); gw.state.sent.length = 0; gw.state.session = 'ready'; gw.state.sendStatus = 201; gw.state.attempts = 0; for (const k of Object.keys(gw.state.others)) gw.state.others[k].status = 'ready'; };

  async function addPerson(flatId: string | null, role: SystemRole, residencyType: ResidencyType, over: { isPrimary?: boolean; phone?: string | null } = {}) {
    personNo += 1;
    const email = `w${personNo}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: {
        email, firstName: `${residencyType === 'TENANT' ? 'Tenant' : 'Owner'}${personNo}`, lastName: 'Test',
        phone: over.phone === undefined ? autoPhone(personNo) : over.phone,
        passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true,
      },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId, role, residencyType, status: 'ACTIVE', isPrimary: over.isPrimary ?? false } });
    const token = (await http_().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200)).body.data.accessToken as string;
    return { userId: user.id, token };
  }

  async function newFlat() {
    flatNo += 1;
    return (await http_().post('/api/v1/flats').set(auth(admin)).send({ buildingId, unitNumber: `${flatNo}`, flatCode: `W-${flatNo}` }).expect(201)).body.data.id as string;
  }

  /** A period in a given month; its status is set directly, as other e2e specs do. */
  async function newPeriod(status: 'PUBLISHED' | 'REVIEW' = 'PUBLISHED', dueDate?: string) {
    monthNo += 1;
    const year = 2044 + Math.floor((monthNo - 1) / 12);
    const m = ((monthNo - 1) % 12) + 1;
    const mm = String(m).padStart(2, '0');
    const id = (await http_().post('/api/v1/billing/periods').set(auth(admin)).send({
      periodYear: year, periodMonth: m, startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-28`, dueDate: dueDate ?? `${year}-${mm}-10`,
    }).expect(201)).body.data.id as string;
    await prisma.billingPeriod.update({ where: { id }, data: { status } });
    return id;
  }

  async function newBill(periodId: string, flatId: string, amount: number, flatCode: string, published = true) {
    invNo += 1;
    const period = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: periodId } });
    return prisma.maintenanceBill.create({
      data: {
        societyId, billingPeriodId: periodId, flatId, invoiceNumber: `INV-W-${UNIQUE}-${invNo}`, flatCode,
        baseAmount: D(amount), totalAmount: D(amount), pendingAmount: D(amount), dueDate: period.dueDate, isPublished: published,
      },
    });
  }

  beforeAll(async () => {
    await new Promise<void>((r) => gw.server.listen(0, '127.0.0.1', r));
    process.env.WHATSAPP_API_URL = `http://127.0.0.1:${(gw.server.address() as AddressInfo).port}`;
    process.env.WHATSAPP_API_KEY = 'gw-key';
    

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    whatsapp = moduleFixture.get(WhatsappService);
    lateFees = moduleFixture.get(LateFeeService);
    store = moduleFixture.get(WhatsappSettingsStore);
    // A connection saved in the platform console would win over the environment this suite relies on.
    await prisma.platformWhatsappSettings.deleteMany();
    store.invalidate();

    const reg = await http_().post('/api/v1/auth/register-society').send({
      society: { name: `E2E WhatsApp ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-w-${UNIQUE}@test.example`, contactPhone: adminPhone() },
      admin: { firstName: 'Admin', lastName: 'W', email: `admin-w-${UNIQUE}@test.example`, phone: adminPhone(), password: PASSWORD },
    }).expect(201);
    admin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    // Only the platform owner can allow a society to use WhatsApp; done here directly, as the console would.
    await prisma.society.update({ where: { id: societyId }, data: { whatsappAllowed: true, whatsappSessionId: 'sess-1' } });
    buildingId = (await http_().post('/api/v1/buildings').set(auth(admin)).send({ name: 'W', code: 'W' }).expect(201)).body.data.id;
    accountId = (await prisma.account.create({ data: { societyId, name: 'Main', accountType: 'CURRENT' } })).id;
    accountant = (await addPerson(null, SystemRole.SOCIETY_ACCOUNTANT, 'OWNER')).token;
    resident = (await addPerson(await newFlat(), SystemRole.RESIDENT, 'OWNER', { isPrimary: true })).token;
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
    await new Promise((r) => gw.server.close(r));
    delete process.env.WHATSAPP_API_URL;
    delete process.env.WHATSAPP_API_KEY;
    delete process.env.WHATSAPP_DAILY_CAP;
  });

  beforeEach(reset);

  describe('switched off, or not connected', () => {
    it('queues nothing while the society has not switched it on', async () => {
      const f = await newFlat();
      await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true });
      const p = await newPeriod('REVIEW');
      await newBill(p, f, 1000, `W-${flatNo}`, false);
      await http_().post(`/api/v1/billing/periods/${p}/publish`).set(auth(admin)).expect(201);
      expect(await rows()).toHaveLength(0);
    });

    it('queues nothing when the server has no gateway configured, even if the society switched it on', async () => {
      await setConfig({ whatsappEnabled: true });
      const saved = { ...process.env };
      delete process.env.WHATSAPP_API_URL;
      store.invalidate();
      try {
        const f = await newFlat();
        await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true });
        const p = await newPeriod('REVIEW');
        await newBill(p, f, 1000, `W-${flatNo}`, false);
        await http_().post(`/api/v1/billing/periods/${p}/publish`).set(auth(admin)).expect(201);
        expect(await rows()).toHaveLength(0);
        expect((await http_().get('/api/v1/whatsapp/status').set(auth(admin)).expect(200)).body.data.configured).toBe(false);
      } finally {
        process.env.WHATSAPP_API_URL = saved.WHATSAPP_API_URL;
        store.invalidate();
      }
    });

    it('is saved as a setting only the admin can change', async () => {
      await http_().patch('/api/v1/societies/my/config').set(auth(accountant)).send({ whatsappEnabled: true }).expect(403);
      const res = await setConfig({ whatsappEnabled: true, whatsappReminderDays: [10, 5, 5, 20] });
      expect(res.body.data.additionalConfig.whatsapp).toEqual({ enabled: true, reminderDays: [5, 10, 20] });
      await http_().patch('/api/v1/societies/my/config').set(auth(admin)).send({ whatsappReminderDays: [0, 40] }).expect(400);
      // changing one part keeps the other
      const res2 = await setConfig({ whatsappEnabled: false });
      expect(res2.body.data.additionalConfig.whatsapp).toEqual({ enabled: false, reminderDays: [5, 10, 20] });
      await setConfig({ whatsappEnabled: true, whatsappReminderDays: [5, 10] });
    });
  });

  describe('when the bills are published', () => {
    it('queues one message per flat to the tenant (else the owner), and sends them, once each', async () => {
      await setConfig({ whatsappEnabled: true });
      const both = await newFlat(); const bothCode = `W-${flatNo}`;
      await addPerson(both, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(1) });
      await addPerson(both, SystemRole.RESIDENT, 'TENANT', { phone: mobile(2) });
      const ownerOnly = await newFlat(); const ownerCode = `W-${flatNo}`;
      await addPerson(ownerOnly, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(3) });
      const nobody = await newFlat();
      const noPhone = await newFlat();
      await addPerson(noPhone, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: null });
      const p = await newPeriod('REVIEW');
      await newBill(p, both, 3500, bothCode, false);
      await newBill(p, ownerOnly, 2000, ownerCode, false);
      await newBill(p, nobody, 1000, 'W-none', false);
      await newBill(p, noPhone, 1000, 'W-nophone', false);

      await http_().post(`/api/v1/billing/periods/${p}/publish`).set(auth(admin)).expect(201);

      const queued = await rows({ kind: 'BILL_PUBLISHED' });
      expect(queued.map((r) => r.toPhone).sort()).toEqual([wa(2), wa(3)].sort());
      expect(queued.every((r) => r.status === 'PENDING')).toBe(true);
      expect(queued.find((r) => r.toPhone === wa(2))?.body).toContain('Flat *' + bothCode + '*');

      const out = await drain();
      expect(out).toMatchObject({ sent: 2, failed: 0, stopped: null });
      expect(gw.state.sent.map((s) => s.chatId).sort()).toEqual([`${wa(2)}@c.us`, `${wa(3)}@c.us`].sort());
      expect(gw.state.sent.every((s) => s.apiKey === 'gw-key')).toBe(true);
      expect(gw.state.sent[0].key).toMatch(new RegExp(`^${societyId}:published:`));

      // nothing more to send, and running again sends nothing again
      expect(await drain()).toMatchObject({ sent: 0 });
      expect(gw.state.sent).toHaveLength(2);
      expect((await rows()).every((r) => r.status === 'SENT' && r.sentAt)).toBe(true);
    });

    it('does not fail the publish when queueing breaks', async () => {
      await setConfig({ whatsappEnabled: true });
      const f = await newFlat();
      await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(4) });
      const p = await newPeriod('REVIEW');
      await newBill(p, f, 500, `W-${flatNo}`, false);
      const spy = jest.spyOn(whatsapp, 'enqueuePublished').mockRejectedValue(new Error('outbox down'));
      try {
        await http_().post(`/api/v1/billing/periods/${p}/publish`).set(auth(admin)).expect(201);
      } finally {
        spy.mockRestore();
      }
      expect((await prisma.billingPeriod.findUniqueOrThrow({ where: { id: p } })).status).toBe('PUBLISHED');
    });
  });

  describe('reminders on the 5th and 10th', () => {
    const fifth = new Date('2044-03-05T05:30:00Z'); // 11:00 on the 5th in India

    let batch = 0;
    async function unpaidFlats() {
      batch += 1;
      const k = batch * 100; // fresh phone numbers every call: a phone number belongs to one user
      await settleOthers();
      const flat1 = await newFlat(); const c1 = `W-${flatNo}`;
      await addPerson(flat1, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(k + 10) });
      const tenant1 = await addPerson(flat1, SystemRole.RESIDENT, 'TENANT', { phone: mobile(k + 11) });
      const flat2 = await newFlat(); const c2 = `W-${flatNo}`;
      await addPerson(flat2, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(k + 12) });
      const flat3 = await newFlat(); const c3 = `W-${flatNo}`;
      await addPerson(flat3, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(k + 13) });
      const paidFlat = await newFlat();
      await addPerson(paidFlat, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(k + 14) });
      const p = await newPeriod();
      await newBill(p, flat1, 3500, c1);
      await newBill(p, flat2, 2000, c2);
      const b3 = await newBill(p, flat3, 1000, c3);
      const paidBill = await newBill(p, paidFlat, 900, 'W-paid');
      await prisma.maintenanceBill.update({ where: { id: paidBill.id }, data: { isPaid: true, pendingAmount: 0, paidAmount: 900 } });
      return { flat1, tenant1, flat2, flat3, b3, p, ph: { t1: wa(k + 11), o2: wa(k + 12), o3: wa(k + 13) } };
    }

    it('on a reminder day, queues one message per unpaid flat to the tenant else the owner, using the society\'s own wording', async () => {
      await setConfig({ whatsappEnabled: true });
      await http_().patch('/api/v1/societies/my/config').set(auth(admin)).send({ reminderTemplate: 'Hi {name}, flat {flat} owes Rs {amount} for {month}.' }).expect(200);
      const { ph } = await unpaidFlats();

      const n = await whatsapp.enqueueReminders(societyId, fifth);
      expect(n).toBe(3);
      const queued = await rows({ kind: 'REMINDER' });
      expect(queued.map((r) => r.toPhone).sort()).toEqual([ph.t1, ph.o2, ph.o3].sort());
      const tenantMsg = queued.find((r) => r.toPhone === ph.t1)!;
      expect(tenantMsg.body).toMatch(/^Hi Tenant\d+ Test, flat W-\d+ owes Rs 3,500 for [A-Za-z]+ 2044\.$/);
      await http_().patch('/api/v1/societies/my/config').set(auth(admin)).send({ reminderTemplate: '' }).expect(200);
    });

    it('sends at most one reminder per flat per day, however often it runs', async () => {
      await setConfig({ whatsappEnabled: true });
      await unpaidFlats();
      expect(await whatsapp.enqueueReminders(societyId, fifth)).toBe(3);
      expect(await whatsapp.enqueueReminders(societyId, new Date(fifth.getTime() + 3 * 3600_000))).toBe(0);
      expect(await rows({ kind: 'REMINDER' })).toHaveLength(3);
      // the next reminder day is a new day
      expect(await whatsapp.enqueueReminders(societyId, new Date('2044-03-10T06:00:00Z'))).toBe(3);
    });

    it('does nothing on other days of the month', async () => {
      await setConfig({ whatsappEnabled: true });
      await unpaidFlats();
      expect(await whatsapp.enqueueReminders(societyId, new Date('2044-03-06T06:00:00Z'))).toBe(0);
      expect(await whatsapp.enqueueReminders(societyId, new Date('2044-03-04T06:00:00Z'))).toBe(0);
      expect(await rows()).toHaveLength(0);
    });

    it('follows the days the admin chose', async () => {
      await setConfig({ whatsappEnabled: true, whatsappReminderDays: [7] });
      await unpaidFlats();
      expect(await whatsapp.enqueueReminders(societyId, fifth)).toBe(0);
      expect(await whatsapp.enqueueReminders(societyId, new Date('2044-03-07T06:00:00Z'))).toBe(3);
      await setConfig({ whatsappReminderDays: [5, 10] });
    });

    it('leaves out a flat that has already submitted a payment waiting for approval', async () => {
      await setConfig({ whatsappEnabled: true });
      const { flat3, b3, tenant1, ph } = await unpaidFlats();
      await prisma.paymentSubmission.create({
        data: { societyId, flatId: flat3, userId: tenant1.userId, maintenanceBillId: b3.id, amount: D(1000), paymentDate: new Date(), paymentMethod: 'UPI', status: 'PENDING' },
      });
      expect(await whatsapp.enqueueReminders(societyId, fifth)).toBe(2);
      expect((await rows({ kind: 'REMINDER' })).map((r) => r.toPhone)).not.toContain(ph.o3);
    });

    it('names the latest bill and the total owed when a flat owes more than one month', async () => {
      await setConfig({ whatsappEnabled: true });
      await settleOthers();
      const f = await newFlat();
      await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(20) });
      const older = await newPeriod();
      const newer = await newPeriod();
      await newBill(older, f, 1000, `W-${flatNo}`);
      await newBill(newer, f, 1500, `W-${flatNo}`);
      await whatsapp.enqueueReminders(societyId, fifth);
      const msgs = await rows({ kind: 'REMINDER', toPhone: wa(20) });
      expect(msgs).toHaveLength(1);
      expect(msgs[0].body).toContain('₹2,500'); // 1,000 + 1,500 together, in one message
    });

    it('the hourly pass respects the daytime window and the society switch', async () => {
      await setConfig({ whatsappEnabled: true });
      await unpaidFlats();
      expect((await whatsapp.remindersPass(new Date('2044-03-04T20:00:00Z'))).queued).toBe(0); // 01:30 on the 5th, India
      await whatsapp.remindersPass(fifth);
      expect(await rows({ kind: 'REMINDER' })).toHaveLength(3);
      await setConfig({ whatsappEnabled: false });
      await reset();
      await whatsapp.remindersPass(fifth);
      expect(await rows({ kind: 'REMINDER' })).toHaveLength(0);
      await setConfig({ whatsappEnabled: true });
    });
  });

  describe('when a late fine is added', () => {
    it('tells the flat\'s contact the fine and the new amount due — once', async () => {
      await setConfig({ whatsappEnabled: true });
      await settleOthers();
      await prisma.societyConfiguration.update({ where: { societyId }, data: { lateFeeType: 'FIXED', lateFeeValue: 150, gracePeriodDays: 0 } });
      const f = await newFlat();
      await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(30) });
      const tenant = await addPerson(f, SystemRole.RESIDENT, 'TENANT', { phone: mobile(31) });
      const p = await newPeriod('PUBLISHED', '2044-05-10');
      const b = await newBill(p, f, 2000, `W-${flatNo}`);

      // the 10th: still within the due date, no fine, nothing sent
      expect((await lateFees.applyForSociety(societyId, new Date('2044-05-10T06:00:00Z'))).applied).toBe(0);
      expect(await rows({ kind: 'FINE_IMPOSED' })).toHaveLength(0);

      // the 11th: fined, and told
      expect((await lateFees.applyForSociety(societyId, new Date('2044-05-11T06:00:00Z'))).applied).toBe(1);
      const fines = await rows({ kind: 'FINE_IMPOSED' });
      expect(fines).toHaveLength(1);
      expect(fines[0]).toMatchObject({ toPhone: wa(31), recipientUserId: tenant.userId });
      expect(fines[0].body).toContain('late fine of *₹150*');
      expect(fines[0].body).toContain('₹2,150');

      // running again does not fine, or message, a second time
      await lateFees.applyForSociety(societyId, new Date('2044-05-12T06:00:00Z'));
      expect(await rows({ kind: 'FINE_IMPOSED' })).toHaveLength(1);
      expect((await prisma.maintenanceBill.findUniqueOrThrow({ where: { id: b.id } })).lateFee.toString()).toBe('150');
      await prisma.societyConfiguration.update({ where: { societyId }, data: { lateFeeType: null, lateFeeValue: null } });
    });

    it('still adds the fine when the message cannot be queued', async () => {
      await setConfig({ whatsappEnabled: true });
      await settleOthers();
      await prisma.societyConfiguration.update({ where: { societyId }, data: { lateFeeType: 'FIXED', lateFeeValue: 50, gracePeriodDays: 0 } });
      const f = await newFlat();
      await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(32) });
      const p = await newPeriod('PUBLISHED', '2044-06-10');
      const b = await newBill(p, f, 1000, `W-${flatNo}`);
      const spy = jest.spyOn(whatsapp, 'enqueueFine').mockRejectedValue(new Error('outbox down'));
      try {
        expect((await lateFees.applyForSociety(societyId, new Date('2044-06-11T06:00:00Z'))).applied).toBe(1);
      } finally {
        spy.mockRestore();
      }
      expect((await prisma.maintenanceBill.findUniqueOrThrow({ where: { id: b.id } })).lateFee.toString()).toBe('50');
      await prisma.societyConfiguration.update({ where: { societyId }, data: { lateFeeType: null, lateFeeValue: null } });
    });
  });

  describe('when a payment is received', () => {
    it('thanks the person who paid once the admin approves, and says what is still due', async () => {
      await setConfig({ whatsappEnabled: true });
      const f = await newFlat(); const code = `W-${flatNo}`;
      const payer = await addPerson(f, SystemRole.RESIDENT, 'TENANT', { isPrimary: true, phone: mobile(40) });
      const p = await newPeriod();
      const b = await newBill(p, f, 3000, code);

      const submitted = await http_().post('/api/v1/payments').set(auth(payer.token)).send({
        maintenanceBillId: b.id, amount: 1000, paymentDate: '2044-03-02', paymentMethod: 'UPI', utrNumber: `UTR${UNIQUE}`,
      }).expect(201);
      expect(await rows({ kind: 'PAYMENT_RECEIVED' })).toHaveLength(0); // not until approved

      await http_().post(`/api/v1/payments/${submitted.body.data.id}/approve`).set(auth(admin)).send({ accountId }).expect(201);
      const msgs = await rows({ kind: 'PAYMENT_RECEIVED' });
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toMatchObject({ toPhone: wa(40), recipientUserId: payer.userId });
      expect(msgs[0].body).toContain('received *₹1,000*');
      expect(msgs[0].body).toContain('Balance still due: *₹2,000*');

      await drain();
      expect(gw.state.sent.at(-1)?.chatId).toBe(`${wa(40)}@c.us`);
    });

    it('also tells the resident when the admin records the payment, and drops the balance line when paid in full', async () => {
      await setConfig({ whatsappEnabled: true });
      const f = await newFlat();
      const owner = await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(41) });
      const p = await newPeriod();
      const b = await newBill(p, f, 800, `W-${flatNo}`);
      await http_().post('/api/v1/payments/record').set(auth(admin)).send({
        maintenanceBillId: b.id, accountId, amount: 800, paymentDate: '2044-03-02', paymentMethod: 'CASH',
      }).expect(201);
      const msgs = await rows({ kind: 'PAYMENT_RECEIVED' });
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toMatchObject({ toPhone: wa(41), recipientUserId: owner.userId });
      expect(msgs[0].body).not.toContain('Balance still due');
    });

    it('does not fail an approval when queueing breaks', async () => {
      await setConfig({ whatsappEnabled: true });
      const f = await newFlat();
      const payer = await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(42) });
      const p = await newPeriod();
      const b = await newBill(p, f, 500, `W-${flatNo}`);
      const sub = await http_().post('/api/v1/payments').set(auth(payer.token)).send({
        maintenanceBillId: b.id, amount: 500, paymentDate: '2044-03-02', paymentMethod: 'UPI', utrNumber: `UTRB${UNIQUE}`,
      }).expect(201);
      const spy = jest.spyOn(whatsapp, 'enqueuePaid').mockRejectedValue(new Error('outbox down'));
      try {
        await http_().post(`/api/v1/payments/${sub.body.data.id}/approve`).set(auth(admin)).send({ accountId }).expect(201);
      } finally {
        spy.mockRestore();
      }
      expect((await prisma.maintenanceBill.findUniqueOrThrow({ where: { id: b.id } })).isPaid).toBe(true);
    });
  });

  describe('sending carefully', () => {
    async function queueOne(phoneN: number) {
      await setConfig({ whatsappEnabled: true });
      const f = await newFlat();
      await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(phoneN) });
      const p = await newPeriod('REVIEW');
      await newBill(p, f, 700, `W-${flatNo}`, false);
      await http_().post(`/api/v1/billing/periods/${p}/publish`).set(auth(admin)).expect(201);
    }

    it('waits outside the daytime window, and sends once it opens', async () => {
      await queueOne(60);
      expect(await drain({ ignoreWindow: false, now: new Date('2044-03-05T20:30:00Z') })).toMatchObject({ sent: 0, stopped: 'outside the sending window' });
      expect(gw.state.sent).toHaveLength(0);
      expect(await drain({ ignoreWindow: false, now: new Date('2044-03-05T05:00:00Z') })).toMatchObject({ sent: 1 });
    });

    it('sends nothing, and loses nothing, while WhatsApp is not connected', async () => {
      await queueOne(61);
      gw.state.session = 'qr_ready';
      const out = await drain();
      expect(out.sent).toBe(0);
      expect(out.stopped).toContain('qr_ready');
      expect((await rows())[0]).toMatchObject({ status: 'PENDING', attempts: 0 });
      gw.state.session = 'ready';
      expect(await drain()).toMatchObject({ sent: 1 });
    });

    it('stops at once when the gateway refuses, putting the message back untouched', async () => {
      await queueOne(62);
      gw.state.sendStatus = 409; gw.state.sendMessage = 'Session not ready';
      const out = await drain();
      expect(out).toMatchObject({ sent: 0 });
      expect(out.stopped).toContain('Session not ready');
      expect((await rows())[0]).toMatchObject({ status: 'PENDING', attempts: 0 });
      expect(gw.state.attempts).toBe(1);
    });

    it('retries a failing message later, and gives up after three tries', async () => {
      await queueOne(63);
      gw.state.sendStatus = 500; gw.state.sendMessage = 'boom';
      let now = new Date('2044-03-05T05:00:00Z');
      await drain({ now });
      expect((await rows())[0]).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'boom' });
      expect((await rows())[0].sendAfter.getTime()).toBeGreaterThan(now.getTime()); // not straight away
      expect(await drain({ now })).toMatchObject({ sent: 0 }); // too soon, nothing happens
      expect(gw.state.attempts).toBe(1);

      now = new Date(now.getTime() + 2 * 3600_000);
      await drain({ now });
      now = new Date(now.getTime() + 4 * 3600_000);
      await drain({ now });
      expect((await rows())[0]).toMatchObject({ status: 'FAILED', attempts: 3, lastError: 'boom' });
      expect(gw.state.attempts).toBe(3);
    });

    it('gives up at once on a number that is not on WhatsApp', async () => {
      await queueOne(64);
      gw.state.sendStatus = 400; gw.state.sendMessage = 'The number is not registered on WhatsApp';
      const out = await drain();
      expect(out.failed).toBe(1);
      expect((await rows())[0]).toMatchObject({ status: 'FAILED', attempts: 1 });
    });

    it('stops at the daily limit', async () => {
      process.env.WHATSAPP_DAILY_CAP = '1';
      try {
        await queueOne(65); await queueOne(66);
        expect(await drain()).toMatchObject({ sent: 1 });
        expect(await drain()).toMatchObject({ sent: 0, stopped: 'the daily limit is reached' });
        expect(gw.state.sent).toHaveLength(1);
      } finally {
        delete process.env.WHATSAPP_DAILY_CAP;
      }
    });

    it('does not send what was queued before the society switched it off', async () => {
      await queueOne(67);
      await setConfig({ whatsappEnabled: false });
      const out = await drain();
      expect(out).toMatchObject({ sent: 0, failed: 1 });
      expect((await rows())[0].status).toBe('FAILED');
      expect(gw.state.sent).toHaveLength(0);
      await setConfig({ whatsappEnabled: true });
    });

    it('puts back a message left "sending" by a crashed run', async () => {
      await queueOne(68);
      await prisma.whatsappMessage.updateMany({ where: { societyId }, data: { status: 'SENDING', updatedAt: new Date(Date.now() - 3600_000) } });
      expect(await drain()).toMatchObject({ sent: 1 });
    });

    it('two runs at once send each message once', async () => {
      await queueOne(69); await queueOne(70); await queueOne(71);
      const [a, b] = await Promise.all([drain(), drain()]);
      expect(a.sent + b.sent).toBe(3);
      expect(gw.state.sent).toHaveLength(3);
    });
  });

  describe('each society sends from its own number', () => {
    interface Other { id: string; token: string; building: string; session: string }
    let b: Other;
    let bFlatNo = 0;
    let bMonth = 0;

    async function registerOther(label: string, session: string | null, phoneSeed: number): Promise<Other> {
      const ph = '97' + RUN.slice(0, 5) + String(phoneSeed).padStart(3, '0');
      const reg = await http_().post('/api/v1/auth/register-society').send({
        society: { name: `E2E WA ${label} ${UNIQUE}`, address: '3 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-${label}-${UNIQUE}@test.example`, contactPhone: ph },
        admin: { firstName: label, lastName: 'Admin', email: `admin-${label}-${UNIQUE}@test.example`, phone: ph, password: PASSWORD },
      }).expect(201);
      const id = reg.body.data.memberships[0].societyId as string;
      const token = reg.body.data.accessToken as string;
      await prisma.society.update({ where: { id }, data: { whatsappAllowed: true, ...(session ? { whatsappSessionId: session } : {}) } });
      const building = (await http_().post('/api/v1/buildings').set(auth(token)).send({ name: label, code: label.slice(0, 3).toUpperCase() }).expect(201)).body.data.id as string;
      if (session) gw.state.others[session] = { status: 'ready', phone: '9190000' + String(phoneSeed).padStart(5, '0') };
      return { id, token, building, session: session ?? '' };
    }

    /** An unpaid published bill for a new flat of society B, whose resident has the given phone; returns the phone's chat id. */
    async function bBill(owner: Other, phoneN: number): Promise<string> {
      bFlatNo += 1;
      const flat = (await http_().post('/api/v1/flats').set(auth(owner.token)).send({ buildingId: owner.building, unitNumber: `${bFlatNo}`, flatCode: `B-${bFlatNo}` }).expect(201)).body.data.id as string;
      const phone = mobile(phoneN);
      const user = await prisma.user.create({ data: { email: `b${phoneN}-${UNIQUE}@test.example`, firstName: 'Bres', lastName: 'Test', phone, passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true } });
      await prisma.societyMembership.create({ data: { societyId: owner.id, userId: user.id, flatId: flat, role: SystemRole.RESIDENT, residencyType: 'OWNER', status: 'ACTIVE', isPrimary: true } });
      bMonth += 1;
      const period = (await http_().post('/api/v1/billing/periods').set(auth(owner.token)).send({
        periodYear: 2046, periodMonth: ((bMonth - 1) % 12) + 1, startDate: '2046-01-01', endDate: '2046-01-28', dueDate: '2046-01-10',
      }).expect(201)).body.data.id as string;
      await prisma.billingPeriod.update({ where: { id: period }, data: { status: 'REVIEW' } });
      await prisma.maintenanceBill.create({
        data: { societyId: owner.id, billingPeriodId: period, flatId: flat, invoiceNumber: `INV-B-${UNIQUE}-${phoneN}`, flatCode: `B-${bFlatNo}`, baseAmount: D(600), totalAmount: D(600), pendingAmount: D(600), dueDate: new Date('2046-01-10'), isPublished: false },
      });
      await http_().post(`/api/v1/billing/periods/${period}/publish`).set(auth(owner.token)).expect(201);
      return `${wa(phoneN)}@c.us`;
    }
    const enableFor = (o: Other) => http_().patch('/api/v1/societies/my/config').set(auth(o.token)).send({ whatsappEnabled: true }).expect(200);

    beforeAll(async () => { b = await registerOther('Bravo', 'sess-2', 901); });
    afterAll(async () => {
      await prisma.whatsappMessage.deleteMany({ where: { societyId: b.id } });
      await prisma.society.update({ where: { id: b.id }, data: { deletedAt: new Date() } });
    });

    it('sends each society\'s messages through that society\'s own session', async () => {
      await setConfig({ whatsappEnabled: true });
      await enableFor(b);
      const toB = await bBill(b, 910);
      const f = await newFlat();
      await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(911) });
      const p = await newPeriod('REVIEW');
      await newBill(p, f, 700, `W-${flatNo}`, false);
      await http_().post(`/api/v1/billing/periods/${p}/publish`).set(auth(admin)).expect(201);

      const out = await drain();
      expect(out.sent).toBe(2);
      const viaA = gw.state.sent.filter((s) => s.session === 'sess-1');
      const viaB = gw.state.sent.filter((s) => s.session === 'sess-2');
      expect(viaA.map((s) => s.chatId)).toEqual([`${wa(911)}@c.us`]);
      expect(viaB.map((s) => s.chatId)).toEqual([toB]);
      // B's resident was never messaged from A's number, nor A's from B's
      expect(viaA.some((s) => s.chatId === toB)).toBe(false);
    });

    it('one society whose number is not connected does not hold up another', async () => {
      await setConfig({ whatsappEnabled: true });
      await enableFor(b);
      await bBill(b, 920);
      const f = await newFlat();
      await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(921) });
      const p = await newPeriod('REVIEW');
      await newBill(p, f, 700, `W-${flatNo}`, false);
      await http_().post(`/api/v1/billing/periods/${p}/publish`).set(auth(admin)).expect(201);

      gw.state.others['sess-2'].status = 'qr_ready'; // B's phone is logged out
      const out = await drain();
      expect(out.sent).toBe(1); // A still sends
      expect(gw.state.sent.map((s) => s.session)).toEqual(['sess-1']);
      expect((await prisma.whatsappMessage.findMany({ where: { societyId: b.id } })).every((r) => r.status === 'PENDING')).toBe(true); // B waits, loses nothing

      gw.state.others['sess-2'].status = 'ready';
      expect(await drain()).toMatchObject({ sent: 1 }); // and goes out once B is connected again
      expect(gw.state.sent.at(-1)?.session).toBe('sess-2');
    });

    it('the daily limit is per number', async () => {
      process.env.WHATSAPP_DAILY_CAP = '1';
      try {
        await setConfig({ whatsappEnabled: true });
        await enableFor(b);
        for (const n of [930, 931]) await bBill(b, n);
        for (const n of [932, 933]) {
          const f = await newFlat();
          await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(n) });
          const p = await newPeriod('REVIEW');
          await newBill(p, f, 700, `W-${flatNo}`, false);
          await http_().post(`/api/v1/billing/periods/${p}/publish`).set(auth(admin)).expect(201);
        }
        const out = await drain();
        expect(out.sent).toBe(2); // one from each number, though four are waiting
        expect(gw.state.sent.map((s) => s.session).sort()).toEqual(['sess-1', 'sess-2']);
        expect(await drain()).toMatchObject({ sent: 0 });
      } finally {
        delete process.env.WHATSAPP_DAILY_CAP;
      }
    });

    it('each society is shown its own number, and only its own', async () => {
      const a = (await http_().get('/api/v1/whatsapp/status').set(auth(admin)).expect(200)).body.data;
      const bs = (await http_().get('/api/v1/whatsapp/status').set(auth(b.token)).expect(200)).body.data;
      expect(a).toMatchObject({ allowed: true, hasSession: true, session: 'ready', sendingFrom: '919000011111' });
      expect(bs).toMatchObject({ allowed: true, hasSession: true, session: 'ready', sendingFrom: '9190000' + '00901' });
      expect(JSON.stringify(a)).not.toContain('00901');
      expect(JSON.stringify(bs)).not.toContain('919000011111');
    });

    it('a society sends its test message from its own number', async () => {
      const res = (await http_().post('/api/v1/whatsapp/test').set(auth(b.token)).send({ phone: mobile(940) }).expect(200)).body.data;
      expect(res.sent).toBe(true);
      expect(gw.state.sent.at(-1)).toMatchObject({ session: 'sess-2', chatId: `${wa(940)}@c.us` });
    });

    it('a society that has not linked a number cannot switch it on, cannot test, and queues nothing', async () => {
      const c = await registerOther('Charlie', null, 902);
      try {
        const res = await http_().patch('/api/v1/societies/my/config').set(auth(c.token)).send({ whatsappEnabled: true }).expect(400);
        expect(messageOf(res.body)).toMatch(/Connect your WhatsApp number first/);
        const test = (await http_().post('/api/v1/whatsapp/test').set(auth(c.token)).send({ phone: mobile(941) }).expect(200)).body.data;
        expect(test).toMatchObject({ sent: false, error: 'Connect your WhatsApp number first.' });
        expect(await whatsapp.enqueueReminders(c.id, new Date('2044-03-05T05:30:00Z'))).toBe(0);
        expect(gw.state.sent).toHaveLength(0);
        expect((await http_().get('/api/v1/whatsapp/status').set(auth(c.token)).expect(200)).body.data).toMatchObject({ allowed: true, hasSession: false, sendingFrom: null });
      } finally {
        await prisma.society.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
      }
    });

    it('stopping one society drops only its own queue', async () => {
      await setConfig({ whatsappEnabled: true });
      await enableFor(b);
      await bBill(b, 950);
      const f = await newFlat();
      await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(951) });
      const p = await newPeriod('REVIEW');
      await newBill(p, f, 700, `W-${flatNo}`, false);
      await http_().post(`/api/v1/billing/periods/${p}/publish`).set(auth(admin)).expect(201);
      await prisma.society.update({ where: { id: b.id }, data: { whatsappAllowed: false } });
      try {
        const out = await drain();
        expect(out).toMatchObject({ sent: 1, failed: 1 });
        expect(gw.state.sent.map((s) => s.session)).toEqual(['sess-1']);
      } finally {
        await prisma.society.update({ where: { id: b.id }, data: { whatsappAllowed: true } });
      }
    });
  });

  describe('a society the platform owner has not allowed', () => {
    const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));
    const allow = (allowed: boolean) => prisma.society.update({ where: { id: societyId }, data: { whatsappAllowed: allowed } });
    afterEach(async () => { await allow(true); });

    it('cannot switch automation on, and the refusal says why', async () => {
      await setConfig({ whatsappEnabled: false });
      await allow(false);
      const res = await http_().patch('/api/v1/societies/my/config').set(auth(admin)).send({ whatsappEnabled: true }).expect(403);
      expect(messageOf(res.body)).toMatch(/Ask the platform owner/);
      // switching it off, or changing the days and the wording, is still fine: only turning it on is held back
      await http_().patch('/api/v1/societies/my/config').set(auth(admin)).send({ whatsappEnabled: false, whatsappReminderDays: [3] }).expect(200);
      await setConfig({ whatsappReminderDays: [5, 10] });
    });

    it('queues nothing even if the setting was somehow already on', async () => {
      await setConfig({ whatsappEnabled: true });
      await allow(false);
      const f = await newFlat();
      await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(81) });
      const p = await newPeriod('REVIEW');
      await newBill(p, f, 700, `W-${flatNo}`, false);
      await http_().post(`/api/v1/billing/periods/${p}/publish`).set(auth(admin)).expect(201);
      expect(await rows()).toHaveLength(0);
      expect(await whatsapp.enqueueReminders(societyId, new Date('2044-03-05T05:30:00Z'))).toBe(0);
    });

    it('does not send what was queued before it was stopped', async () => {
      await setConfig({ whatsappEnabled: true });
      await prisma.whatsappMessage.create({ data: { societyId, kind: 'REMINDER', dedupeKey: `stop-${UNIQUE}`, toPhone: wa(82), body: 'x', sendAfter: new Date(Date.now() - 5000) } });
      await allow(false);
      const out = await drain();
      expect(out).toMatchObject({ sent: 0, failed: 1 });
      expect((await rows())[0]).toMatchObject({ status: 'FAILED', lastError: 'This society is not allowed to send WhatsApp messages.' });
      expect(gw.state.sent).toHaveLength(0);
    });

    it('is not shown the platform\'s number, and cannot send a test', async () => {
      await allow(false);
      const status = (await http_().get('/api/v1/whatsapp/status').set(auth(admin)).expect(200)).body.data;
      expect(status).toMatchObject({ allowed: false, sendingFrom: null });
      const test = (await http_().post('/api/v1/whatsapp/test').set(auth(admin)).send({ phone: mobile(83) }).expect(200)).body.data;
      expect(test.sent).toBe(false);
      expect(test.error).toMatch(/Ask the platform owner/);
      expect(gw.state.sent).toHaveLength(0);
      await allow(true);
      expect((await http_().get('/api/v1/whatsapp/status').set(auth(admin)).expect(200)).body.data).toMatchObject({ allowed: true, sendingFrom: '919000011111' });
    });

    it('a suspended society never sends, even if it was allowed', async () => {
      await setConfig({ whatsappEnabled: true });
      await prisma.society.update({ where: { id: societyId }, data: { isActive: false } });
      try {
        await prisma.whatsappMessage.create({ data: { societyId, kind: 'REMINDER', dedupeKey: `susp-${UNIQUE}`, toPhone: wa(84), body: 'x', sendAfter: new Date(Date.now() - 5000) } });
        expect(await drain()).toMatchObject({ sent: 0, failed: 1 });
      } finally {
        await prisma.society.update({ where: { id: societyId }, data: { isActive: true } });
      }
    });
  });

  describe('for the admin', () => {
    it('shows whether WhatsApp is connected and what is waiting', async () => {
      await setConfig({ whatsappEnabled: true });
      const res = (await http_().get('/api/v1/whatsapp/status').set(auth(accountant)).expect(200)).body.data;
      expect(res).toMatchObject({ configured: true, enabled: true, reminderDays: [5, 10], session: 'ready', sendingFrom: '919000011111', queued: 0 });
      gw.state.session = 'disconnected';
      expect((await http_().get('/api/v1/whatsapp/status').set(auth(admin)).expect(200)).body.data.session).toBe('disconnected');
    });

    it('lists the latest messages and whether each was sent', async () => {
      await prisma.whatsappMessage.create({ data: { societyId, kind: 'REMINDER', dedupeKey: 'x', toPhone: wa(80), body: 'b', status: 'FAILED', lastError: 'nope' } });
      const list = (await http_().get('/api/v1/whatsapp/messages').set(auth(admin)).expect(200)).body.data as any[];
      expect(list[0]).toMatchObject({ kind: 'REMINDER', status: 'FAILED', lastError: 'nope' });
      expect(list[0]).not.toHaveProperty('body'); // other people's messages are not displayed back
    });

    it('sends a test message to a number, for the admin only', async () => {
      const ok = await http_().post('/api/v1/whatsapp/test').set(auth(admin)).send({ phone: `+91 ${mobile(90)}` }).expect(200);
      expect(ok.body.data).toEqual({ sent: true });
      expect(gw.state.sent.at(-1)?.chatId).toBe(`${wa(90)}@c.us`);
      expect((await http_().post('/api/v1/whatsapp/test').set(auth(admin)).send({ phone: '12345678' }).expect(200)).body.data).toMatchObject({ sent: false });
      gw.state.sendStatus = 409; gw.state.sendMessage = 'Session not ready';
      expect((await http_().post('/api/v1/whatsapp/test').set(auth(admin)).send({ phone: mobile(91) }).expect(200)).body.data).toMatchObject({ sent: false, error: 'Session not ready' });
      await http_().post('/api/v1/whatsapp/test').set(auth(accountant)).send({ phone: mobile(90) }).expect(403);
      await http_().post('/api/v1/whatsapp/test').set(auth(resident)).send({ phone: mobile(90) }).expect(403);
    });

    it('is closed to residents', async () => {
      await http_().get('/api/v1/whatsapp/status').set(auth(resident)).expect(403);
      await http_().get('/api/v1/whatsapp/messages').set(auth(resident)).expect(403);
    });
  });

  /* ─────────────────── a society that sends through its own Meta account ─────────────────── */

  describe('a society that sends through its own Meta WhatsApp Business account', () => {
    const TOKEN = 'EAAG-secret-token-123';
    const PHONE_ID = '109876543210987';
    const WABA = '208765432109876';
    const graph = fakeGraph(TOKEN, PHONE_ID, WABA);
    let base: string;

    const connectCloud = (body: Record<string, unknown> = { phoneNumberId: PHONE_ID, accessToken: TOKEN, wabaId: WABA }, token = admin) =>
      http_().put('/api/v1/whatsapp/cloud').set(auth(token)).send(body);
    const resetGraph = () => {
      graph.state.sent.length = 0; graph.state.fail = null; graph.state.validToken = TOKEN;
      graph.state.templates = CLOUD_TEMPLATES.map((t) => ({ name: t.name, status: 'APPROVED', language: 'en' }));
    };

    beforeAll(async () => {
      await new Promise<void>((r) => graph.server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(graph.server.address() as AddressInfo).port}`;
      process.env.WHATSAPP_CLOUD_API_BASE = base;
    });
    afterAll(async () => {
      await http_().delete('/api/v1/whatsapp/cloud').set(auth(admin));
      await prisma.societyWhatsappCloud.deleteMany({ where: { societyId } });
      await new Promise((r) => graph.server.close(r));
      delete process.env.WHATSAPP_CLOUD_API_BASE;
    });
    beforeEach(resetGraph);

    it('checks the details with Meta before saving them, and refuses wrong ones in Meta\'s words', async () => {
      const bad = await connectCloud({ phoneNumberId: PHONE_ID, accessToken: 'wrong', wabaId: WABA }).expect(400);
      expect(messageOf(bad.body)).toMatch(/Meta did not accept/);
      expect(await prisma.societyWhatsappCloud.count({ where: { societyId } })).toBe(0);
      await connectCloud({ phoneNumberId: 'abc', accessToken: TOKEN }).expect(400);
      await connectCloud({ phoneNumberId: PHONE_ID }).expect(400); // the first time a token is needed
    });

    it('is for the society admin only, and only once the platform owner has allowed it', async () => {
      await connectCloud(undefined, accountant).expect(403);
      await connectCloud(undefined, resident).expect(403);
      await prisma.society.update({ where: { id: societyId }, data: { whatsappAllowed: false } });
      try {
        expect(messageOf((await connectCloud().expect(403)).body)).toMatch(/not switched on/);
      } finally {
        await prisma.society.update({ where: { id: societyId }, data: { whatsappAllowed: true } });
      }
    });

    it('saves the token encrypted, never sends it back, and starts sending through Meta', async () => {
      const res = (await connectCloud().expect(200)).body.data;
      expect(res).toMatchObject({ provider: 'CLOUD', linked: true, status: 'ready', displayPhone: '919000022222', verifiedName: 'Sunrise Residency', phoneNumberId: PHONE_ID, wabaId: WABA, templatesReady: true });
      expect(JSON.stringify(res)).not.toContain(TOKEN);
      const row = await prisma.societyWhatsappCloud.findFirstOrThrow({ where: { societyId } });
      expect(row.accessTokenEnc.startsWith('v1.')).toBe(true);
      expect(row.accessTokenEnc).not.toContain(TOKEN);
      expect(JSON.stringify(await prisma.auditLog.findMany({ where: { entityType: 'SocietyWhatsappCloud' } }))).not.toContain(TOKEN);
      expect((await prisma.society.findUniqueOrThrow({ where: { id: societyId } })).whatsappProvider).toBe('CLOUD');
      // A blank token keeps the saved one.
      await connectCloud({ phoneNumberId: PHONE_ID, accessToken: '', wabaId: WABA }).expect(200);
    });

    it('queues a published bill as the approved template, filled in, and sends exactly that', async () => {
      await connectCloud().expect(200);
      await setConfig({ whatsappEnabled: true });
      const f = await newFlat(); const code = `W-${flatNo}`;
      await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(751) });
      const p = await newPeriod('REVIEW');
      await newBill(p, f, 3500, code, false);
      await http_().post(`/api/v1/billing/periods/${p}/publish`).set(auth(admin)).expect(201);

      const queued = await rows({ kind: 'BILL_PUBLISHED' });
      expect(queued).toHaveLength(1);
      expect(queued[0].toPhone).toBe(wa(751));
      expect(queued[0].params).toMatchObject({ flat: code, amount: '3,500' });
      // What the history shows is the template's wording, not the free text a linked number would send.
      expect(queued[0].body).toContain(`maintenance bill for Flat ${code} is ready. Amount due: ₹3,500.`);
      expect(queued[0].body).not.toContain('*');

      expect(await drain()).toMatchObject({ sent: 1, failed: 0, stopped: null });
      expect(gw.state.sent).toHaveLength(0); // nothing went through the linked-number gateway
      expect(graph.state.sent).toHaveLength(1);
      const sent = graph.state.sent[0];
      expect(sent).toMatchObject({ phoneId: PHONE_ID, auth: `Bearer ${TOKEN}`, to: wa(751), template: 'ng_bill_published', language: 'en' });
      expect(sent.params).toHaveLength(6);
      expect(sent.params[2]).toBe(code);
      expect(sent.params[3]).toBe('3,500');
      expect((await rows({ kind: 'BILL_PUBLISHED' }))[0].status).toBe('SENT');
    });

    it('sends a reminder, a late fine and a payment receipt as their own templates', async () => {
      await connectCloud().expect(200);
      await setConfig({ whatsappEnabled: true });
      await settleOthers();
      const f = await newFlat(); const code = `W-${flatNo}`;
      const person = await addPerson(f, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: mobile(752) });
      const p = await newPeriod('PUBLISHED', '2030-01-10');
      const bill = await newBill(p, f, 2000, code);

      // The society's own reminder wording is for a linked number; Meta gets the approved template.
      await setConfig({ reminderTemplate: 'MY OWN WORDING {name}' });
      expect(await whatsapp.enqueueReminders(societyId, new Date('2044-03-05T06:00:00Z'))).toBe(1);
      await prisma.maintenanceBill.update({ where: { id: bill.id }, data: { lateFee: D(150), pendingAmount: D(2150) } });
      expect(await whatsapp.enqueueFine(societyId, bill.id)).toBe(true);
      const pay = await prisma.paymentSubmission.create({
        data: { societyId, flatId: f, userId: person.userId, maintenanceBillId: bill.id, amount: D(2150), paymentDate: new Date('2044-03-06'), paymentMethod: 'UPI', status: 'APPROVED' },
      });
      expect(await whatsapp.enqueuePaid(societyId, pay.id)).toBe(true);

      expect((await rows({ kind: 'REMINDER' }))[0].body).not.toContain('MY OWN WORDING');
      expect(await drain()).toMatchObject({ sent: 3, failed: 0 });
      expect(graph.state.sent.map((m) => m.template).sort()).toEqual(['ng_late_fine', 'ng_payment_received', 'ng_payment_reminder']);
      const fine = graph.state.sent.find((m) => m.template === 'ng_late_fine') as { params: string[] };
      expect(fine.params).toEqual([expect.any(String), expect.any(String), code, '150', '2,150', expect.any(String)]);
      await setConfig({ reminderTemplate: '' });
    });

    it('holds a society\'s messages when Meta refuses its token, while another society still sends', async () => {
      await connectCloud().expect(200);
      await prisma.whatsappMessage.create({ data: { societyId, kind: 'PAYMENT_RECEIVED', dedupeKey: `tok-${UNIQUE}`, sendAfter: new Date(Date.now() - 5_000), toPhone: wa(43), body: 'b', params: { name: 'A', amount: '1', flat: 'F', paidOn: 'd', balance: '0', society: 'S' } } });
      graph.state.validToken = 'rotated';
      const out = await drain();
      expect(out.sent).toBe(0);
      expect(out.stopped).toMatch(/Meta refused the access token/);
      const row = (await rows({ dedupeKey: `tok-${UNIQUE}` }))[0];
      expect(row).toMatchObject({ status: 'PENDING', attempts: 0 }); // not blamed on the message
      expect((await http_().get('/api/v1/whatsapp/cloud').set(auth(admin)).expect(200)).body.data).toMatchObject({ status: 'token_invalid' });
      graph.state.validToken = TOKEN;
      expect(await drain()).toMatchObject({ sent: 1 });
    });

    it('holds messages when a template is not approved, and fails one for a number that cannot receive', async () => {
      await connectCloud().expect(200);
      const params = { name: 'A', amount: '1', flat: 'F', paidOn: 'd', balance: '0', society: 'S' };
      await prisma.whatsappMessage.create({ data: { societyId, kind: 'PAYMENT_RECEIVED', dedupeKey: `tpl-${UNIQUE}`, sendAfter: new Date(Date.now() - 5_000), toPhone: wa(44), body: 'b', params } });
      graph.state.fail = { status: 400, code: 132001, message: 'Template name does not exist in the translation' };
      const held = await drain();
      expect(held.stopped).toMatch(/template is not ready/);
      expect((await rows({ dedupeKey: `tpl-${UNIQUE}` }))[0]).toMatchObject({ status: 'PENDING', attempts: 0 });

      graph.state.fail = { status: 400, code: 131026, message: 'Message undeliverable' };
      expect(await drain()).toMatchObject({ sent: 0, failed: 1 });
      expect((await rows({ dedupeKey: `tpl-${UNIQUE}` }))[0]).toMatchObject({ status: 'FAILED' });
    });

    it('fails what was queued for a linked number rather than sending it as a template', async () => {
      await connectCloud().expect(200);
      await prisma.whatsappMessage.create({ data: { societyId, kind: 'REMINDER', dedupeKey: `old-${UNIQUE}`, sendAfter: new Date(Date.now() - 5_000), toPhone: wa(45), body: 'free text' } });
      expect(await drain()).toMatchObject({ sent: 0, failed: 1 });
      expect(graph.state.sent).toHaveLength(0);
    });

    it('sends a test with Meta\'s own hello_world template', async () => {
      await connectCloud().expect(200);
      const ok = await http_().post('/api/v1/whatsapp/test').set(auth(admin)).send({ phone: `+91 ${mobile(46)}` }).expect(200);
      expect(ok.body.data).toEqual({ sent: true });
      expect(graph.state.sent.at(-1)).toMatchObject({ template: 'hello_world', language: 'en_US', to: wa(46), params: [] });
      graph.state.fail = { status: 400, code: 131030, message: 'Recipient phone number not in allowed list' };
      const no = (await http_().post('/api/v1/whatsapp/test').set(auth(admin)).send({ phone: mobile(47) }).expect(200)).body.data;
      expect(no).toMatchObject({ sent: false });
      expect(no.error).toMatch(/not in allowed list/);
    });

    it('submits the four templates that are missing, and leaves existing ones alone', async () => {
      await connectCloud().expect(200);
      graph.state.templates = [{ name: 'ng_late_fine', status: 'PENDING', language: 'en' }];
      const res = (await http_().post('/api/v1/whatsapp/cloud/templates').set(auth(admin)).expect(200)).body.data;
      expect(res.submitted.sort()).toEqual(['ng_bill_published', 'ng_payment_received', 'ng_payment_reminder']);
      expect(graph.state.created.map((c) => c.name).sort()).toEqual(res.submitted.sort());
      expect(graph.state.created[0]).toMatchObject({ language: 'en', category: 'UTILITY' });
      expect(graph.state.created[0].components[0].example.body_text[0].length).toBe(graph.state.created[0].components[0].text.match(/\{\{\d+\}\}/g).length);
      expect(res.templates.find((t: any) => t.name === 'ng_late_fine').status).toBe('PENDING');
      expect(res.templatesReady).toBe(false);
      await http_().post('/api/v1/whatsapp/cloud/templates').set(auth(accountant)).expect(403);
    });

    it('shows the admin and the mobile app whether it is connected and sending from its own business number', async () => {
      await connectCloud().expect(200);
      const res = (await http_().get('/api/v1/whatsapp/status').set(auth(accountant)).expect(200)).body.data;
      expect(res).toMatchObject({ provider: 'CLOUD', configured: true, allowed: true, hasSession: true, session: 'ready', sendingFrom: '919000022222', templatesReady: true });
    });

    it('can be switched back to a linked number, which drops what was waiting for the other way', async () => {
      await connectCloud().expect(200);
      await prisma.whatsappMessage.create({ data: { societyId, kind: 'REMINDER', dedupeKey: `sw-${UNIQUE}`, sendAfter: new Date(Date.now() - 5_000), toPhone: wa(48), body: 'b', params: {} } });
      const res = (await http_().put('/api/v1/whatsapp/provider').set(auth(admin)).send({ provider: 'OPENWA' }).expect(200)).body.data;
      expect(res.provider).toBe('OPENWA');
      expect((await rows({ dedupeKey: `sw-${UNIQUE}` }))[0]).toMatchObject({ status: 'FAILED' });
      // And back again without re-entering anything: the account is still saved.
      expect((await http_().put('/api/v1/whatsapp/provider').set(auth(admin)).send({ provider: 'CLOUD' }).expect(200)).body.data.provider).toBe('CLOUD');
      await http_().put('/api/v1/whatsapp/provider').set(auth(admin)).send({ provider: 'FAX' }).expect(400);
      await http_().put('/api/v1/whatsapp/provider').set(auth(accountant)).send({ provider: 'OPENWA' }).expect(403);
    });

    it('stops sending when the platform owner switches the society off, even with a valid account', async () => {
      await connectCloud().expect(200);
      await prisma.whatsappMessage.create({ data: { societyId, kind: 'PAYMENT_RECEIVED', dedupeKey: `off-${UNIQUE}`, sendAfter: new Date(Date.now() - 5_000), toPhone: wa(49), body: 'b', params: {} } });
      await prisma.society.update({ where: { id: societyId }, data: { whatsappAllowed: false } });
      try {
        expect(await drain()).toMatchObject({ sent: 0, failed: 1 });
        expect(graph.state.sent).toHaveLength(0);
        expect((await http_().get('/api/v1/whatsapp/status').set(auth(admin)).expect(200)).body.data).toMatchObject({ allowed: false });
      } finally {
        await prisma.society.update({ where: { id: societyId }, data: { whatsappAllowed: true } });
      }
    });

    it('forgets the account on disconnect and goes back to the linked number', async () => {
      await connectCloud().expect(200);
      const res = (await http_().delete('/api/v1/whatsapp/cloud').set(auth(admin)).expect(200)).body.data;
      expect(res).toMatchObject({ provider: 'OPENWA', linked: false });
      expect(await prisma.societyWhatsappCloud.count({ where: { societyId } })).toBe(0);
      expect((await http_().put('/api/v1/whatsapp/provider').set(auth(admin)).send({ provider: 'CLOUD' }).expect(400)).body).toBeDefined();
    });
  });
});

/** A stand-in for Meta's Graph API: the phone number, message templates, and sending a template. */
function fakeGraph(token: string, phoneId: string, wabaId: string) {
  const state = {
    validToken: token,
    sent: [] as { phoneId: string; auth: string; to: string; template: string; language: string; params: string[] }[],
    created: [] as any[],
    templates: [] as { name: string; status: string; language: string }[],
    fail: null as null | { status: number; code: number; message: string },
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      const error = (status: number, code: number, message: string) => send(status, { error: { message, code, type: 'OAuthException' } });
      if (req.headers.authorization !== `Bearer ${state.validToken}`) return error(401, 190, 'Invalid OAuth access token.');
      const url = new URL(req.url ?? '', 'http://x');
      const parts = url.pathname.split('/').filter(Boolean); // [version, id, ...]
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      if (req.method === 'GET' && parts.length === 2 && parts[1] === phoneId) return send(200, { id: phoneId, display_phone_number: '+91 90000 22222', verified_name: 'Sunrise Residency' });
      if (req.method === 'POST' && parts[1] === phoneId && parts[2] === 'messages') {
        if (state.fail) return error(state.fail.status, state.fail.code, state.fail.message);
        const t = body.template;
        state.sent.push({ phoneId, auth: String(req.headers.authorization), to: body.to, template: t.name, language: t.language.code, params: (t.components?.[0]?.parameters ?? []).map((p: any) => p.text) });
        return send(200, { messaging_product: 'whatsapp', messages: [{ id: `wamid.${state.sent.length}` }] });
      }
      if (parts[1] === wabaId && parts[2] === 'message_templates') {
        if (req.method === 'GET') return send(200, { data: state.templates });
        if (req.method === 'POST') { state.created.push(body); state.templates.push({ name: body.name, status: 'PENDING', language: body.language }); return send(200, { id: '1', status: 'PENDING', category: body.category }); }
      }
      return error(404, 100, 'Unsupported request');
    });
  });
  return { state, server };
}
