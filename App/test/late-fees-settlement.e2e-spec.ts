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

    it('refuses a payment bigger than the flat owes, saying how much it owes', async () => {
      const t = await threeMonths();
      const res = await submitPayment(t.token, t.oct.id, 3000.5).expect(400);
      expect(messageOf(res.body)).toMatch(/owes \(₹3000\)/);
      expect(await prisma.paymentSubmission.count({ where: { flatId: t.flatId } })).toBe(0);
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

    it('two payments approved at the same moment are settled one after the other — together never more than owed', async () => {
      const t = await threeMonths();
      const a = await submitPayment(t.token, t.oct.id, 2000).expect(201);
      const b = await submitPayment(t.token, t.oct.id, 2000).expect(201);
      const results = await Promise.all([approve(a.body.data.id), approve(b.body.data.id)]);
      const won = results.filter((r) => r.status === 201);
      const lost = results.filter((r) => r.status !== 201);
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(messageOf(lost[0].body)).toMatch(/exceeds what this flat owes/);

      const paid = (await prisma.maintenanceBill.findMany({ where: { flatId: t.flatId } })).reduce((s, x) => s.plus(x.paidAmount), D(0));
      expect(paid.toString()).toBe('2000');
      // The loser changed nothing: still PENDING, and the account was credited once.
      const statuses = await prisma.paymentSubmission.findMany({ where: { flatId: t.flatId }, select: { status: true } });
      expect(statuses.map((s) => s.status).sort()).toEqual(['APPROVED', 'PENDING']);
      expect(await prisma.transaction.count({ where: { societyId, linkedEntityType: 'PAYMENT', linkedEntityId: { in: [a.body.data.id, b.body.data.id] } } })).toBe(1);
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
});
