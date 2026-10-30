/**
 * Late fines and oldest-first settlement, against a REAL Postgres, through real HTTP.
 *
 * What a fake cannot prove: that a bill is fined once even when the pass runs from several places at
 * once, that two payments for one flat approved together are settled one after the other and never
 * pay more than is owed, and that the dues clear oldest month first.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Prisma, SystemRole } from '@prisma/client';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { LateFeeService } from '../src/billing/late-fee.service';

jest.setTimeout(90_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const phone = (n: number) => '90' + String(UNIQUE).slice(-7) + String(n);
const D = (n: number | string) => new Prisma.Decimal(n);
/** Long after every bill below is due. */
const LATER = new Date('2041-06-01T06:30:00.000Z');

describe('Late fines and oldest-first settlement (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let lateFees: LateFeeService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let accountant: string;
  let societyId: string;
  let accountId: string;
  let buildingId: string;
  let monthNo = 0;
  let flatNo = 0;
  let utrNo = 0;

  const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));

  async function makeUser(label: string, role: SystemRole, flatId: string | null = null): Promise<{ token: string; userId: string }> {
    const email = `${label}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: { email, firstName: label, lastName: 'Test', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId, role, status: 'ACTIVE', isPrimary: role === SystemRole.RESIDENT } });
    const login = await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200);
    return { token: login.body.data.accessToken as string, userId: user.id };
  }

  async function newFlat() {
    flatNo += 1;
    const flat = (await http().post('/api/v1/flats').set(auth(admin)).send({ buildingId, unitNumber: `${flatNo}`, flatCode: `F-${flatNo}` }).expect(201)).body.data.id as string;
    const res = await makeUser(`res${flatNo}`, SystemRole.RESIDENT, flat);
    return { flatId: flat, token: res.token, userId: res.userId };
  }

  /** A published period (a month in 2040) with its due date. */
  async function newPeriod(status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED', dueDate = '2040-02-10') {
    monthNo += 1;
    const year = 2040 + Math.floor((monthNo - 1) / 12);
    const m = ((monthNo - 1) % 12) + 1;
    const mm = String(m).padStart(2, '0');
    const id = (await http().post('/api/v1/billing/periods').set(auth(admin)).send({
      periodYear: year, periodMonth: m, startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-28`, dueDate,
    }).expect(201)).body.data.id as string;
    await prisma.billingPeriod.update({ where: { id: id }, data: { status } });
    return { id, year, month: m, dueDate };
  }

  let invNo = 0;
  async function newBill(periodId: string, flatId: string, amount: number, over: Partial<Prisma.MaintenanceBillUncheckedCreateInput> = {}) {
    invNo += 1;
    const period = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: periodId } });
    return prisma.maintenanceBill.create({
      data: {
        societyId, billingPeriodId: periodId, flatId, invoiceNumber: `INV-${UNIQUE}-${invNo}`, flatCode: 'X',
        baseAmount: D(amount), totalAmount: D(amount), pendingAmount: D(amount), dueDate: period.dueDate,
        isPublished: period.status !== 'DRAFT', ...over,
      },
    });
  }

  const setFine = (data: { lateFeeType: string | null; lateFeeValue?: number; lateFeeMaxAmount?: number | null; gracePeriodDays?: number }) =>
    prisma.societyConfiguration.update({ where: { societyId }, data: { lateFeeValue: data.lateFeeValue ?? 0, lateFeeMaxAmount: data.lateFeeMaxAmount ?? null, gracePeriodDays: data.gracePeriodDays ?? 5, lateFeeType: data.lateFeeType } });
  const bill = (id: string) => prisma.maintenanceBill.findUniqueOrThrow({ where: { id } });

  function submitPayment(token: string, billId: string, amount: number) {
    utrNo += 1;
    return http().post('/api/v1/payments').set(auth(token)).send({
      maintenanceBillId: billId, amount, paymentDate: '2040-03-01', paymentMethod: 'UPI', utrNumber: `UTR${UNIQUE}${utrNo}`,
    });
  }
  const approve = (id: string) => http().post(`/api/v1/payments/${id}/approve`).set(auth(admin)).send({ accountId });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    lateFees = moduleFixture.get(LateFeeService);

    const reg = await http().post('/api/v1/auth/register-society').send({
      society: { name: `E2E Fines ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-f-${UNIQUE}@test.example`, contactPhone: phone(1) },
      admin: { firstName: 'Admin', lastName: 'F', email: `admin-f-${UNIQUE}@test.example`, phone: phone(1), password: PASSWORD },
    }).expect(201);
    admin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    buildingId = (await http().post('/api/v1/buildings').set(auth(admin)).send({ name: 'F', code: 'F' }).expect(201)).body.data.id;
    accountId = (await prisma.account.create({ data: { societyId, name: 'Main', accountType: 'CURRENT' } })).id;
    accountant = (await makeUser('acct', SystemRole.SOCIETY_ACCOUNTANT)).token;
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
  });

  /* ───────────────────────────── late fines ───────────────────────────── */

  describe('the late fine', () => {
    it('adds a fixed fine to an overdue bill, once, and shows it on the bill', async () => {
      await setFine({ lateFeeType: 'FIXED', lateFeeValue: 100 });
      const p = await newPeriod();
      const { flatId } = await newFlat();
      const b = await newBill(p.id, flatId, 1000);

      const first = await lateFees.applyForSociety(societyId, LATER);
      expect(first.applied).toBeGreaterThanOrEqual(1);
      const after = await bill(b.id);
      expect(after.lateFee.toString()).toBe('100');
      expect(after.totalAmount.toString()).toBe('1100');
      expect(after.pendingAmount.toString()).toBe('1100');
      expect(after.lateFeeAppliedAt).not.toBeNull();
      const items = await prisma.billLineItem.findMany({ where: { maintenanceBillId: b.id, componentType: 'LATE_FEE' } });
      expect(items).toHaveLength(1);
      expect(items[0].amount.toString()).toBe('100');

      // A second pass changes nothing.
      await lateFees.applyForSociety(societyId, LATER);
      expect((await bill(b.id)).lateFee.toString()).toBe('100');
    });

    it('fines once even when the pass runs from many places at the same moment', async () => {
      await setFine({ lateFeeType: 'FIXED', lateFeeValue: 75 });
      const p = await newPeriod();
      const { flatId } = await newFlat();
      const b = await newBill(p.id, flatId, 1000);
      await Promise.all(Array.from({ length: 8 }, () => lateFees.applyForSociety(societyId, LATER)));
      const after = await bill(b.id);
      expect(after.lateFee.toString()).toBe('75');
      expect(after.totalAmount.toString()).toBe('1075');
      expect(await prisma.billLineItem.count({ where: { maintenanceBillId: b.id, componentType: 'LATE_FEE' } })).toBe(1);
    });

    it('takes a percentage of what is still unpaid on that bill, up to the cap', async () => {
      await setFine({ lateFeeType: 'PERCENTAGE', lateFeeValue: 10, lateFeeMaxAmount: 150 });
      const p = await newPeriod();
      const { flatId: f1 } = await newFlat();
      const { flatId: f2 } = await newFlat();
      const small = await newBill(p.id, f1, 1000); // 10% = 100, under the cap
      const big = await newBill(p.id, f2, 5000); // 10% = 500, capped at 150
      await lateFees.applyForSociety(societyId, LATER);
      expect((await bill(small.id)).lateFee.toString()).toBe('100');
      expect((await bill(big.id)).lateFee.toString()).toBe('150');
    });

    it('charges a percentage on the unpaid part only, when the bill was part-paid', async () => {
      await setFine({ lateFeeType: 'PERCENTAGE', lateFeeValue: 10 });
      const p = await newPeriod();
      const { flatId } = await newFlat();
      const b = await newBill(p.id, flatId, 1000, { paidAmount: D(600), pendingAmount: D(400) });
      await lateFees.applyForSociety(societyId, LATER);
      const after = await bill(b.id);
      expect(after.lateFee.toString()).toBe('40');
      expect(after.pendingAmount.toString()).toBe('440');
    });

    it('does not fine within the grace days, nor a bill that is not due yet', async () => {
      await setFine({ lateFeeType: 'FIXED', lateFeeValue: 100, gracePeriodDays: 5 });
      const p = await newPeriod('PUBLISHED', '2040-06-10');
      const { flatId } = await newFlat();
      const b = await newBill(p.id, flatId, 1000);
      // 15 June, India: still the last free day (10 + 5).
      await lateFees.applyForSociety(societyId, new Date('2040-06-15T06:30:00.000Z'));
      expect((await bill(b.id)).lateFee.toString()).toBe('0');
      // 16 June: overdue.
      await lateFees.applyForSociety(societyId, new Date('2040-06-16T06:30:00.000Z'));
      expect((await bill(b.id)).lateFee.toString()).toBe('100');
    });

    it('leaves alone a paid bill, an unpublished one, and everything when no fine is set', async () => {
      await setFine({ lateFeeType: 'FIXED', lateFeeValue: 100 });
      const p = await newPeriod();
      const d = await newPeriod('DRAFT');
      const { flatId } = await newFlat();
      const paid = await newBill(p.id, flatId, 1000, { isPaid: true, paidAmount: D(1000), pendingAmount: D(0) });
      const draft = await newBill(d.id, flatId, 1000);
      await lateFees.applyForSociety(societyId, LATER);
      expect((await bill(paid.id)).lateFee.toString()).toBe('0');
      expect((await bill(draft.id)).lateFee.toString()).toBe('0');

      await setFine({ lateFeeType: 'NONE', lateFeeValue: 100 });
      const q = await newPeriod();
      const { flatId: f2 } = await newFlat();
      const off = await newBill(q.id, f2, 1000);
      await lateFees.applyForSociety(societyId, LATER);
      expect((await bill(off.id)).lateFee.toString()).toBe('0');
    });

    it('keeps the period totals in step', async () => {
      await setFine({ lateFeeType: 'FIXED', lateFeeValue: 100 });
      const p = await newPeriod();
      const { flatId: f1 } = await newFlat();
      const { flatId: f2 } = await newFlat();
      await newBill(p.id, f1, 1000);
      await newBill(p.id, f2, 2000);
      await lateFees.applyForSociety(societyId, LATER);
      const period = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: p.id } });
      expect(period.totalBilled.toString()).toBe('3200');
      expect(period.totalPending.toString()).toBe('3200');
      expect(period.totalCollected.toString()).toBe('0');
    });

    it('can be run from the screen — admin and accountant, not a resident', async () => {
      await setFine({ lateFeeType: 'FIXED', lateFeeValue: 100 });
      const r = await newFlat();
      await http().post('/api/v1/billing/late-fees/apply').set(auth(r.token)).expect(403);
      await http().post('/api/v1/billing/late-fees/apply').set(auth(accountant)).expect(201);
      await http().post('/api/v1/billing/late-fees/apply').set(auth(admin)).expect(201);
    });
  });

  describe('waiving a fine', () => {
    async function finedBill() {
      await setFine({ lateFeeType: 'FIXED', lateFeeValue: 100 });
      const p = await newPeriod();
      const { flatId } = await newFlat();
      const b = await newBill(p.id, flatId, 1000);
      await lateFees.applyForSociety(societyId, LATER);
      return { b, p };
    }
    const waive = (token: string, id: string, reason = 'Paid on time, bank delay') =>
      http().post(`/api/v1/billing/bills/${id}/waive-late-fee`).set(auth(token)).send({ reason });

    it('takes the fine off, and the bill is not fined again', async () => {
      const { b } = await finedBill();
      await waive(admin, b.id).expect(201);
      const after = await bill(b.id);
      expect(after.lateFee.toString()).toBe('0');
      expect(after.totalAmount.toString()).toBe('1000');
      expect(after.pendingAmount.toString()).toBe('1000');
      expect(await prisma.billLineItem.count({ where: { maintenanceBillId: b.id, componentType: 'LATE_FEE' } })).toBe(0);

      await lateFees.applyForSociety(societyId, LATER);
      expect((await bill(b.id)).lateFee.toString()).toBe('0'); // waived is waived
    });

    it('keeps the reason in the audit trail', async () => {
      const { b } = await finedBill();
      await waive(admin, b.id, 'Committee decision, flat was away').expect(201);
      const rows = await prisma.auditLog.findMany({ where: { societyId, entityId: b.id, action: 'BILL_MODIFIED' } });
      expect(JSON.stringify(rows.map((r) => r.newValues))).toContain('Committee decision, flat was away');
    });

    it('is the admin\'s alone, needs a reason, and needs a fine to waive', async () => {
      const { b } = await finedBill();
      await waive(accountant, b.id).expect(403);
      await http().post(`/api/v1/billing/bills/${b.id}/waive-late-fee`).set(auth(admin)).send({}).expect(400);
      await waive(admin, b.id).expect(201);
      await waive(admin, b.id).expect(403); // nothing left to waive
    });

    it('marks a part-paid bill paid when the waiver leaves nothing owing', async () => {
      await setFine({ lateFeeType: 'FIXED', lateFeeValue: 100 });
      const p = await newPeriod();
      const { flatId } = await newFlat();
      const b = await newBill(p.id, flatId, 1000, { paidAmount: D(1000), pendingAmount: D(0), isPaid: true });
      // Paid in full but fined by hand-made data: simulate a fine laid on after a late payment landed.
      await prisma.maintenanceBill.update({ where: { id: b.id }, data: { lateFee: D(100), totalAmount: D(1100), pendingAmount: D(100), isPaid: false, lateFeeAppliedAt: new Date() } });
      await waive(admin, b.id).expect(201);
      const after = await bill(b.id);
      expect(after.isPaid).toBe(true);
      expect(after.pendingAmount.toString()).toBe('0');
    });

    it('does not reach another society\'s bill', async () => {
      const other = await http().post('/api/v1/auth/register-society').send({
        society: { name: `E2E Fines B ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-fb-${UNIQUE}@test.example`, contactPhone: phone(9) },
        admin: { firstName: 'Admin', lastName: 'B', email: `admin-fb-${UNIQUE}@test.example`, phone: phone(9), password: PASSWORD },
      }).expect(201);
      const { b } = await finedBill();
      await waive(other.body.data.accessToken, b.id).expect(404);
      expect((await bill(b.id)).lateFee.toString()).toBe('100');
      await prisma.society.update({ where: { id: other.body.data.memberships[0].societyId }, data: { deletedAt: new Date() } });
    });
  });

  /* ──────────────────────────── settlement ──────────────────────────── */

  describe('paying — oldest dues first', () => {
    /** Aug, Sep and Oct, 1000 each, all published and unpaid. */
    async function threeMonths() {
      const flat = await newFlat();
      const aug = await newBill((await newPeriod()).id, flat.flatId, 1000);
      const sep = await newBill((await newPeriod()).id, flat.flatId, 1000);
      const oct = await newBill((await newPeriod()).id, flat.flatId, 1000);
      return { ...flat, aug, sep, oct };
    }

    it('settles the oldest month before a newer one, whichever bill the payment was made against', async () => {
      const t = await threeMonths();
      const sub = await submitPayment(t.token, t.oct.id, 1500).expect(201);
      await approve(sub.body.data.id).expect(201);

      expect((await bill(t.aug.id)).isPaid).toBe(true);
      expect((await bill(t.aug.id)).pendingAmount.toString()).toBe('0');
      expect((await bill(t.sep.id)).pendingAmount.toString()).toBe('500');
      expect((await bill(t.sep.id)).isPaid).toBe(false);
      expect((await bill(t.oct.id)).pendingAmount.toString()).toBe('1000'); // the month it was "for" is untouched
    });

    it('records how the payment was shared, and the shares add up to the payment', async () => {
      const t = await threeMonths();
      const sub = await submitPayment(t.token, t.oct.id, 1500).expect(201);
      await approve(sub.body.data.id).expect(201);
      const rows = await prisma.paymentAllocation.findMany({ where: { paymentId: sub.body.data.id } });
      expect(rows.map((r) => [r.billId, r.amount.toString()]).sort()).toEqual(
        [[t.aug.id, '1000'], [t.sep.id, '500']].sort(),
      );
      expect(rows.reduce((s, r) => s.plus(r.amount), D(0)).toString()).toBe('1500');
    });

    it('clears everything when the whole amount owed is paid', async () => {
      const t = await threeMonths();
      const sub = await submitPayment(t.token, t.oct.id, 3000).expect(201);
      await approve(sub.body.data.id).expect(201);
      for (const b of [t.aug, t.sep, t.oct]) {
        const after = await bill(b.id);
        expect(after.isPaid).toBe(true);
        expect(after.pendingAmount.toString()).toBe('0');
        expect(after.paidAmount.toString()).toBe('1000');
      }
    });

    it('keeps each period\'s collected and pending totals right', async () => {
      const t = await threeMonths();
      const sub = await submitPayment(t.token, t.oct.id, 1500).expect(201);
      await approve(sub.body.data.id).expect(201);
      const totals = async (id: string) => prisma.billingPeriod.findUniqueOrThrow({ where: { id } });
      const aug = await totals(t.aug.billingPeriodId);
      expect(aug.totalCollected.toString()).toBe('1000');
      expect(aug.totalPending.toString()).toBe('0');
      const sep = await totals(t.sep.billingPeriodId);
      expect(sep.totalCollected.toString()).toBe('500');
      expect(sep.totalPending.toString()).toBe('500');
    });

    it('counts the late fine as part of what is owed, and clears it with the month it belongs to', async () => {
      await setFine({ lateFeeType: 'FIXED', lateFeeValue: 100 });
      const t = await threeMonths();
      await lateFees.applyForSociety(societyId, LATER);
      expect((await bill(t.aug.id)).pendingAmount.toString()).toBe('1100');
      const sub = await submitPayment(t.token, t.oct.id, 1100).expect(201);
      await approve(sub.body.data.id).expect(201);
      expect((await bill(t.aug.id)).isPaid).toBe(true); // 1000 + its 100 fine
    });

    it('does not touch another flat\'s bills, or bills not published yet', async () => {
      const t = await threeMonths();
      const other = await newFlat();
      const theirs = await newBill((await newPeriod()).id, other.flatId, 1000);
      const draft = await newBill((await newPeriod('DRAFT')).id, t.flatId, 1000);
      const sub = await submitPayment(t.token, t.oct.id, 3000).expect(201);
      await approve(sub.body.data.id).expect(201);
      expect((await bill(theirs.id)).pendingAmount.toString()).toBe('1000');
      expect((await bill(draft.id)).pendingAmount.toString()).toBe('1000');
    });

    it('two payments approved at the same moment are settled one after the other — the dues are cleared once and the rest is advance', async () => {
      const t = await threeMonths(); // owes 3000
      const a = await submitPayment(t.token, t.oct.id, 2000).expect(201);
      const b = await submitPayment(t.token, t.oct.id, 2000).expect(201);
      const results = await Promise.all([approve(a.body.data.id), approve(b.body.data.id)]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);

      const bills = await prisma.maintenanceBill.findMany({ where: { flatId: t.flatId } });
      expect(bills.reduce((s, x) => s.plus(x.paidAmount), D(0)).toString()).toBe('3000'); // never more than the bills
      for (const x of bills) expect(x.isPaid).toBe(true);
      // 4000 came in, 3000 settled the bills, so 1000 is kept ahead — exactly once, however the two interleaved.
      const flat = await prisma.flat.findUniqueOrThrow({ where: { id: t.flatId } });
      expect(flat.creditBalance.toString()).toBe('1000');
      const entries = await prisma.flatCreditEntry.findMany({ where: { flatId: t.flatId } });
      expect(entries.reduce((s, e) => s.plus(e.amount), D(0)).toString()).toBe('1000');
      expect(await prisma.transaction.count({ where: { societyId, linkedEntityType: 'PAYMENT', linkedEntityId: { in: [a.body.data.id, b.body.data.id] } } })).toBe(2);
    });

    it('a payment racing the late-fine pass never deadlocks — the same race, many times over', async () => {
      // Postgres takes a share lock on the flat whenever ANY of its bills is updated; a full lock on the flat in
      // settlement once deadlocked against the fine pass about one run in three. This repeats the race so it
      // cannot come back unnoticed.
      await setFine({ lateFeeType: 'FIXED', lateFeeValue: 100 });
      for (let i = 0; i < 15; i++) {
        const t = await threeMonths();
        const sub = await submitPayment(t.token, t.oct.id, 1000).expect(201);
        const [approved] = await Promise.all([approve(sub.body.data.id), lateFees.applyForSociety(societyId, LATER)]);
        expect(approved.status).toBe(201);
        for (const x of await prisma.maintenanceBill.findMany({ where: { flatId: t.flatId } })) {
          expect(x.totalAmount.minus(x.paidAmount).toString()).toBe(x.pendingAmount.toString());
        }
      }
    });

    it('two payments that together fit are both settled when approved together', async () => {
      const t = await threeMonths();
      const a = await submitPayment(t.token, t.oct.id, 1500).expect(201);
      const b = await submitPayment(t.token, t.oct.id, 1500).expect(201);
      const results = await Promise.all([approve(a.body.data.id), approve(b.body.data.id)]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      for (const x of [t.aug, t.sep, t.oct]) expect((await bill(x.id)).isPaid).toBe(true);
    });

    it('settles a payment made while a fine lands at the same time without losing either', async () => {
      await setFine({ lateFeeType: 'FIXED', lateFeeValue: 100 });
      const t = await threeMonths();
      const sub = await submitPayment(t.token, t.oct.id, 1000).expect(201);
      await Promise.all([approve(sub.body.data.id), lateFees.applyForSociety(societyId, LATER)]);
      const bills = await prisma.maintenanceBill.findMany({ where: { flatId: t.flatId } });
      // Whatever the order, the books agree: total = paid + pending on every bill.
      for (const x of bills) expect(x.totalAmount.minus(x.paidAmount).toString()).toBe(x.pendingAmount.toString());
      expect(bills.reduce((s, x) => s.plus(x.paidAmount), D(0)).toString()).toBe('1000');
    });
  });

  /* ──────────────────────────── arrears ──────────────────────────── */

  describe('the statement\'s arrears', () => {
    it('are earlier months only — never a later month\'s bill', async () => {
      const flat = await newFlat();
      const earlier = await newPeriod();
      const middle = await newPeriod();
      const later = await newPeriod();
      await newBill(earlier.id, flat.flatId, 700);
      await newBill(middle.id, flat.flatId, 1000);
      await newBill(later.id, flat.flatId, 900);

      const arrearsIn = async (periodId: string) => {
        const s = (await http().get(`/api/v1/billing/periods/${periodId}/statement`).set(auth(admin)).expect(200)).body.data.statements as { flatId: string; arrears: number }[];
        return s.find((x) => x.flatId === flat.flatId)!.arrears;
      };
      expect(await arrearsIn(earlier.id)).toBe(0); // nothing came before it
      expect(await arrearsIn(middle.id)).toBe(700); // only the earlier month
      expect(await arrearsIn(later.id)).toBe(1700); // both earlier months
    });
  });

/* ───────────────────────────── advance credit ───────────────────────────── */

  describe('paying ahead — advance credit', () => {
    async function threeMonths() {
      const flat = await newFlat();
      const aug = await newBill((await newPeriod()).id, flat.flatId, 1000);
      const sep = await newBill((await newPeriod()).id, flat.flatId, 1000);
      const oct = await newBill((await newPeriod()).id, flat.flatId, 1000);
      return { ...flat, aug, sep, oct };
    }
    const creditOf = async (flatId: string) => (await prisma.flat.findUniqueOrThrow({ where: { id: flatId } })).creditBalance;
    const ledgerSum = async (flatId: string) =>
      (await prisma.flatCreditEntry.aggregate({ where: { flatId }, _sum: { amount: true } }))._sum.amount ?? D(0);
    /** A draft period with one unpublished bill, ready to publish. */
    async function draftBill(flatId: string, amount: number) {
      const period = await newPeriod('DRAFT');
      const bill = await newBill(period.id, flatId, amount, { isPublished: false });
      await prisma.billingPeriod.update({ where: { id: period.id }, data: { status: 'CALCULATED' } });
      return { period, bill };
    }
    const publish = (periodId: string) => http().post(`/api/v1/billing/periods/${periodId}/publish`).set(auth(admin));

    it('clears every due, and keeps the rest of the payment as the flat\'s advance', async () => {
      const t = await threeMonths();
      const sub = await submitPayment(t.token, t.oct.id, 3500).expect(201);
      await approve(sub.body.data.id).expect(201);
      for (const b of [t.aug, t.sep, t.oct]) expect((await bill(b.id)).isPaid).toBe(true);
      expect((await creditOf(t.flatId)).toString()).toBe('500');
      const entries = await prisma.flatCreditEntry.findMany({ where: { flatId: t.flatId } });
      expect(entries.map((e) => [e.kind, e.amount.toString(), e.paymentId])).toEqual([['ADVANCE_PAYMENT', '500', sub.body.data.id]]);
    });

    it('accepts a payment when nothing is owed — all of it is advance', async () => {
      const flat = await newFlat();
      const paid = await newBill((await newPeriod()).id, flat.flatId, 1000, { isPaid: true, paidAmount: D(1000), pendingAmount: D(0) });
      const sub = await submitPayment(flat.token, paid.id, 2500).expect(201);
      await approve(sub.body.data.id).expect(201);
      expect((await creditOf(flat.flatId)).toString()).toBe('2500');
    });

    it('is applied to the flat\'s next bill when it is published — part covers it', async () => {
      const t = await threeMonths();
      const sub = await submitPayment(t.token, t.oct.id, 4000).expect(201);
      await approve(sub.body.data.id).expect(201); // 1000 advance
      const { bill: next } = await draftBill(t.flatId, 2500);
      expect((await bill(next.id)).paidAmount.toString()).toBe('0'); // nothing yet: it is only a draft

      await publish(next.billingPeriodId).expect(201);
      const after = await bill(next.id);
      expect(after.isPublished).toBe(true);
      expect(after.paidAmount.toString()).toBe('1000');
      expect(after.pendingAmount.toString()).toBe('1500');
      expect(after.isPaid).toBe(false);
      expect((await creditOf(t.flatId)).toString()).toBe('0');
      const used = await prisma.flatCreditEntry.findMany({ where: { flatId: t.flatId, kind: 'APPLIED_TO_BILL' } });
      expect(used.map((e) => [e.billId, e.amount.toString()])).toEqual([[next.id, '-1000']]);
    });

    it('pays the whole bill when the credit is enough, and keeps the remainder', async () => {
      const flat = await newFlat();
      await prisma.flat.update({ where: { id: flat.flatId }, data: { creditBalance: D(3000) } });
      await prisma.flatCreditEntry.create({ data: { societyId, flatId: flat.flatId, amount: D(3000), kind: 'ADVANCE_PAYMENT' } });
      const { bill: next } = await draftBill(flat.flatId, 2500);
      await publish(next.billingPeriodId).expect(201);
      const after = await bill(next.id);
      expect(after.isPaid).toBe(true);
      expect(after.pendingAmount.toString()).toBe('0');
      expect((await creditOf(flat.flatId)).toString()).toBe('500');
    });

    it('keeps the period\'s collected and pending totals right after applying it', async () => {
      const flat = await newFlat();
      await prisma.flat.update({ where: { id: flat.flatId }, data: { creditBalance: D(1000) } });
      const { period } = await draftBill(flat.flatId, 2500);
      await publish(period.id).expect(201);
      const p = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
      expect(p.totalCollected.toString()).toBe('1000');
      expect(p.totalPending.toString()).toBe('1500');
    });

    it('leaves another flat\'s bill alone', async () => {
      const rich = await newFlat();
      const other = await newFlat();
      await prisma.flat.update({ where: { id: rich.flatId }, data: { creditBalance: D(5000) } });
      const mine = await draftBill(rich.flatId, 2500);
      const theirs = await newBill(mine.period.id, other.flatId, 2500, { isPublished: false });
      await publish(mine.period.id).expect(201);
      expect((await bill(theirs.id)).paidAmount.toString()).toBe('0');
      expect((await bill(mine.bill.id)).isPaid).toBe(true);
    });

    it('spends a credit only once when two periods are published at the same moment', async () => {
      const flat = await newFlat();
      await prisma.flat.update({ where: { id: flat.flatId }, data: { creditBalance: D(1000) } });
      await prisma.flatCreditEntry.create({ data: { societyId, flatId: flat.flatId, amount: D(1000), kind: 'ADVANCE_PAYMENT' } });
      const one = await draftBill(flat.flatId, 800);
      const two = await draftBill(flat.flatId, 800);
      const results = await Promise.all([publish(one.period.id), publish(two.period.id)]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      const applied = (await bill(one.bill.id)).paidAmount.plus((await bill(two.bill.id)).paidAmount);
      expect(applied.toString()).toBe('1000'); // never 1600: the credit was 1000
      expect((await creditOf(flat.flatId)).toString()).toBe('0');
      expect((await ledgerSum(flat.flatId)).toString()).toBe('0'); // +1000 in, -1000 out
    });

    it('survives a payment and a publish for the same flat at the same moment — no deadlock, books agree', async () => {
      const t = await threeMonths();
      const first = await submitPayment(t.token, t.oct.id, 3300).expect(201);
      const { bill: next, period } = await draftBill(t.flatId, 2000);
      const [a, b] = await Promise.all([approve(first.body.data.id), publish(period.id)]);
      expect([a.status, b.status]).toEqual([201, 201]);
      const credit = await creditOf(t.flatId);
      expect(credit.greaterThanOrEqualTo(0)).toBe(true);
      expect((await ledgerSum(t.flatId)).toString()).toBe(credit.toString());
      for (const x of await prisma.maintenanceBill.findMany({ where: { flatId: t.flatId } })) {
        expect(x.totalAmount.minus(x.paidAmount).toString()).toBe(x.pendingAmount.toString());
      }
      void next;
    });

    it('lets a resident see their own flat\'s advance, and only their own', async () => {
      const mine = await newFlat();
      const theirs = await newFlat();
      const paid = await newBill((await newPeriod()).id, mine.flatId, 1000, { isPaid: true, paidAmount: D(1000), pendingAmount: D(0) });
      const sub = await submitPayment(mine.token, paid.id, 1800).expect(201);
      await approve(sub.body.data.id).expect(201);

      const seen = (await http().get('/api/v1/billing/my-credit').set(auth(mine.token)).expect(200)).body.data;
      expect(seen.balance).toBe('1800');
      expect(seen.entries.map((e: { kind: string; amount: string }) => [e.kind, e.amount])).toEqual([['ADVANCE_PAYMENT', '1800']]);

      const other = (await http().get('/api/v1/billing/my-credit').set(auth(theirs.token)).expect(200)).body.data;
      expect(other.balance).toBe('0');
      expect(other.entries).toEqual([]);
    });

    it('never lets the credit go below zero, whatever the order of things', async () => {
      const flat = await newFlat();
      await prisma.flat.update({ where: { id: flat.flatId }, data: { creditBalance: D(100) } });
      await expect(prisma.flat.update({ where: { id: flat.flatId }, data: { creditBalance: { decrement: 200 } } })).rejects.toThrow();
    });

    it('refuses an amount that is clearly a typo — more than a year ahead', async () => {
      const t = await threeMonths(); // owes 3000; each bill is 1000, so the ceiling is 3000 + 12000
      await submitPayment(t.token, t.oct.id, 15000).expect(201);
      const res = await submitPayment(t.token, t.oct.id, 15000.01).expect(400);
      expect(messageOf(res.body)).toMatch(/more than this flat can pay at once/);
    });

    it('shows on the statement: what was paid ahead and used on each bill, and what the flat still holds', async () => {
      const flat = await newFlat();
      await prisma.flat.update({ where: { id: flat.flatId }, data: { creditBalance: D(4000) } });
      const { period, bill: next } = await draftBill(flat.flatId, 2500);
      await publish(period.id).expect(201);
      const rows = (await http().get(`/api/v1/billing/periods/${period.id}/statement`).set(auth(admin)).expect(200)).body.data.statements as { billId: string; advanceApplied: number; advanceBalance: number }[];
      const row = rows.find((r) => r.billId === next.id)!;
      expect(row.advanceApplied).toBe(2500);
      expect(row.advanceBalance).toBe(1500);
    });

    it('does not fine a bill the credit has already paid', async () => {
      await setFine({ lateFeeType: 'FIXED', lateFeeValue: 100 });
      const flat = await newFlat();
      await prisma.flat.update({ where: { id: flat.flatId }, data: { creditBalance: D(5000) } });
      const { period, bill: next } = await draftBill(flat.flatId, 2500);
      await publish(period.id).expect(201);
      await lateFees.applyForSociety(societyId, LATER);
      expect((await bill(next.id)).lateFee.toString()).toBe('0');
    });
  });
});
