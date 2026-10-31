/**
 * Standing flat discounts, correcting a locked opening balance, and refunding an advance — against a REAL
 * Postgres, through real HTTP.
 *
 * What a fake cannot prove: that a discount is taken off every generated bill and survives a regenerate,
 * that a correction moves overpaid money into the flat's advance and leaves the books adding up, and that
 * a refund takes the money out of the credit, the account and the ledger together — or none of them.
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

jest.setTimeout(90_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const phone = (n: number) => '90' + String(UNIQUE).slice(-7) + String(n);
const D = (n: number | string) => new Prisma.Decimal(n);

describe('Flat discounts, corrections and refunds (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let accountant: string;
  let societyId: string;
  let buildingId: string;
  let accountId: string;
  let flatNo = 0;
  let monthNo = 0;
  let utrNo = 0;
  const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));

  async function makeUser(label: string, role: SystemRole, flatId: string | null = null): Promise<{ token: string }> {
    const email = `${label}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: { email, firstName: label, lastName: 'Test', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId, role, status: 'ACTIVE', isPrimary: role === SystemRole.RESIDENT } });
    const login = await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200);
    return { token: login.body.data.accessToken as string };
  }

  async function newFlat() {
    flatNo += 1;
    const code = `D-${flatNo}`;
    const flatId = (await http().post('/api/v1/flats').set(auth(admin)).send({ buildingId, unitNumber: `${flatNo}`, flatCode: code }).expect(201)).body.data.id as string;
    const res = await makeUser(`dres${flatNo}`, SystemRole.RESIDENT, flatId);
    return { flatId, code, token: res.token };
  }

  /** A period in 2044 (one per call), so periods start on known dates. */
  async function newPeriod() {
    monthNo += 1;
    const year = 2044 + Math.floor((monthNo - 1) / 12);
    const m = ((monthNo - 1) % 12) + 1;
    const mm = String(m).padStart(2, '0');
    const id = (await http().post('/api/v1/billing/periods').set(auth(admin)).send({
      periodYear: year, periodMonth: m, startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-28`, dueDate: `${year}-${mm}-10`,
    }).expect(201)).body.data.id as string;
    return { id, start: `${year}-${mm}-01` };
  }
  const generate = (periodId: string) => http().post(`/api/v1/billing/periods/${periodId}/generate`).set(auth(admin)).expect(201);
  const billOf = (periodId: string, flatId: string) =>
    prisma.maintenanceBill.findFirstOrThrow({ where: { billingPeriodId: periodId, flatId }, include: { lineItems: true } });

  const createDiscount = (body: Record<string, unknown>, token = admin) => http().post('/api/v1/billing/flat-discounts').set(auth(token)).send(body);
  const saveOpening = (rows: { flatCode: string; amount: number }[]) =>
    http().post('/api/v1/billing/opening-balances').set(auth(admin)).send({ asOfDate: '2026-03-31', rows });
  const correct = (flatId: string, body: Record<string, unknown>, token = admin) =>
    http().post(`/api/v1/billing/opening-balances/${flatId}/correct`).set(auth(token)).send(body);
  const refund = (body: Record<string, unknown>, token = admin) => http().post('/api/v1/billing/advance-credits/refund').set(auth(token)).send(body);
  const flatRow = (id: string) => prisma.flat.findUniqueOrThrow({ where: { id } });
  const openingBill = (flatId: string) => prisma.maintenanceBill.findFirstOrThrow({ where: { flatId, billingPeriod: { kind: 'OPENING' } } });

  function submitPayment(token: string, billId: string, amount: number) {
    utrNo += 1;
    return http().post('/api/v1/payments').set(auth(token)).send({
      maintenanceBillId: billId, amount, paymentDate: '2044-03-01', paymentMethod: 'UPI', utrNumber: `UTRD${UNIQUE}${utrNo}`,
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

    const reg = await http().post('/api/v1/auth/register-society').send({
      society: { name: `E2E Discounts ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-d-${UNIQUE}@test.example`, contactPhone: phone(1) },
      admin: { firstName: 'Admin', lastName: 'D', email: `admin-d-${UNIQUE}@test.example`, phone: phone(1), password: PASSWORD },
    }).expect(201);
    admin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    buildingId = (await http().post('/api/v1/buildings').set(auth(admin)).send({ name: 'D', code: 'D' }).expect(201)).body.data.id;
    accountId = (await prisma.account.create({ data: { societyId, name: 'Main', accountType: 'CURRENT', currentBalance: D(100_000) } })).id;
    accountant = (await makeUser('dacct', SystemRole.SOCIETY_ACCOUNTANT)).token;
    // The maintenance everyone is billed: ₹3,500 a flat.
    await http().post('/api/v1/billing-rules').set(auth(admin)).send({
      name: 'Maintenance', calculationType: 'EQUAL_PER_FLAT', effectiveFrom: '2040-01-01T00:00:00.000Z', config: { amount: 3500 },
    }).expect(201);
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
  });

  /* ───────────────────────── standing flat discounts ───────────────────────── */

  describe('standing discounts', () => {
    it('takes a fixed amount off the flat, on its bill and its statement, and nobody else\'s', async () => {
      const a = await newFlat();
      const b = await newFlat();
      await createDiscount({ flatId: a.flatId, type: 'FIXED', value: 500, reason: 'Senior citizen', effectiveFrom: '2044-01-01' }).expect(201);
      const p = await newPeriod();
      await generate(p.id);

      const billA = await billOf(p.id, a.flatId);
      expect(billA.baseAmount.toString()).toBe('3500');
      expect(billA.adjustments.toString()).toBe('-500');
      expect(billA.totalAmount.toString()).toBe('3000');
      expect(billA.pendingAmount.toString()).toBe('3000');
      const line = billA.lineItems.find((l) => l.componentType === 'DISCOUNT')!;
      expect(line.amount.toString()).toBe('-500');
      expect(line.description).toBe('Senior citizen');

      const billB = await billOf(p.id, b.flatId);
      expect(billB.totalAmount.toString()).toBe('3500');
      expect(billB.lineItems.some((l) => l.componentType === 'DISCOUNT')).toBe(false);

      const stmt = (await http().get(`/api/v1/billing/periods/${p.id}/statement`).set(auth(admin)).expect(200)).body.data.statements;
      const row = stmt.find((s: any) => s.flatId === a.flatId);
      expect(row.adjustments).toBe(-500);
      expect(row.totalPayable).toBe(3000);
    });

    it('takes a percentage of the maintenance', async () => {
      const a = await newFlat();
      await createDiscount({ flatId: a.flatId, type: 'PERCENT', value: 10, reason: 'Founder member', effectiveFrom: '2044-01-01' }).expect(201);
      const p = await newPeriod();
      await generate(p.id);
      const bill = await billOf(p.id, a.flatId);
      expect(bill.totalAmount.toString()).toBe('3150');
      expect(bill.adjustments.toString()).toBe('-350');
    });

    it('is kept when the bills are regenerated, which wipes a one-off adjustment', async () => {
      const a = await newFlat();
      await createDiscount({ flatId: a.flatId, type: 'FIXED', value: 200, reason: 'Concession', effectiveFrom: '2044-01-01' }).expect(201);
      const p = await newPeriod();
      await generate(p.id);
      await generate(p.id);
      await generate(p.id);
      const bill = await billOf(p.id, a.flatId);
      expect(bill.totalAmount.toString()).toBe('3300');
      expect(bill.lineItems.filter((l) => l.componentType === 'DISCOUNT')).toHaveLength(1);
    });

    it('applies only to periods inside its dates', async () => {
      const a = await newFlat();
      // Starts in a month well after the periods this test generates, so these two are untouched.
      await createDiscount({ flatId: a.flatId, type: 'FIXED', value: 700, reason: 'From 2049', effectiveFrom: '2049-01-01', effectiveTo: '2049-12-31' }).expect(201);
      const p = await newPeriod();
      await generate(p.id);
      expect((await billOf(p.id, a.flatId)).totalAmount.toString()).toBe('3500');

      // One that has ended.
      const b = await newFlat();
      await createDiscount({ flatId: b.flatId, type: 'FIXED', value: 700, reason: 'Ended', effectiveFrom: '2030-01-01', effectiveTo: '2030-12-31' }).expect(201);
      const p2 = await newPeriod();
      await generate(p2.id);
      expect((await billOf(p2.id, b.flatId)).totalAmount.toString()).toBe('3500');
    });

    it('never takes a bill below zero, however many or large', async () => {
      const a = await newFlat();
      await createDiscount({ flatId: a.flatId, type: 'FIXED', value: 9000, reason: 'Waiver', effectiveFrom: '2044-01-01' }).expect(201);
      await createDiscount({ flatId: a.flatId, type: 'PERCENT', value: 50, reason: 'Also', effectiveFrom: '2044-01-01' }).expect(201);
      const p = await newPeriod();
      await generate(p.id);
      const bill = await billOf(p.id, a.flatId);
      expect(bill.totalAmount.toString()).toBe('0');
      expect(bill.adjustments.toString()).toBe('-3500');
    });

    it('can be switched off, changed and removed, and the list says which is in force', async () => {
      const a = await newFlat();
      const created = (await createDiscount({ flatId: a.flatId, type: 'FIXED', value: 100, reason: 'Temporary', effectiveFrom: '2026-01-01' }).expect(201)).body.data;

      let list = (await http().get('/api/v1/billing/flat-discounts').set(auth(admin)).expect(200)).body.data;
      expect(list.find((d: any) => d.id === created.id)).toMatchObject({ flatCode: a.code, value: '100', status: 'ACTIVE', reason: 'Temporary' });

      await http().patch(`/api/v1/billing/flat-discounts/${created.id}`).set(auth(admin)).send({ isActive: false }).expect(200);
      list = (await http().get('/api/v1/billing/flat-discounts').set(auth(admin)).expect(200)).body.data;
      expect(list.find((d: any) => d.id === created.id).status).toBe('OFF');
      const p = await newPeriod();
      await generate(p.id);
      expect((await billOf(p.id, a.flatId)).totalAmount.toString()).toBe('3500');

      await http().patch(`/api/v1/billing/flat-discounts/${created.id}`).set(auth(admin)).send({ isActive: true, value: 250 }).expect(200);
      await generate(p.id);
      expect((await billOf(p.id, a.flatId)).totalAmount.toString()).toBe('3250');

      await http().delete(`/api/v1/billing/flat-discounts/${created.id}`).set(auth(admin)).expect(200);
      await generate(p.id);
      expect((await billOf(p.id, a.flatId)).totalAmount.toString()).toBe('3500');
      expect(await prisma.auditLog.count({ where: { societyId, entityType: 'FlatDiscount', entityId: created.id } })).toBe(4);
    });

    it('refuses nonsense and keeps it to admins and accountants', async () => {
      const a = await newFlat();
      const ok = { flatId: a.flatId, type: 'FIXED', value: 100, reason: 'Valid reason', effectiveFrom: '2044-01-01' };
      expect(messageOf((await createDiscount({ ...ok, type: 'PERCENT', value: 150 }).expect(400)).body)).toMatch(/100%/);
      expect(messageOf((await createDiscount({ ...ok, effectiveTo: '2043-12-31' }).expect(400)).body)).toMatch(/end date/i);
      await createDiscount({ ...ok, value: 0 }).expect(400);
      await createDiscount({ ...ok, value: -5 }).expect(400);
      await createDiscount({ ...ok, reason: 'x' }).expect(400);
      await createDiscount({ ...ok, flatId: '00000000-0000-4000-8000-000000000000' }).expect(404);
      await createDiscount(ok, a.token).expect(403);
      await http().get('/api/v1/billing/flat-discounts').set(auth(a.token)).expect(403);
      await createDiscount(ok, accountant).expect(201);
    });

    it('cannot touch another society\'s discount', async () => {
      const other = await http().post('/api/v1/auth/register-society').send({
        society: { name: `E2E Discounts Other ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-d2-${UNIQUE}@test.example`, contactPhone: phone(3) },
        admin: { firstName: 'Admin', lastName: 'O', email: `admin-d2-${UNIQUE}@test.example`, phone: phone(3), password: PASSWORD },
      }).expect(201);
      const otherToken = other.body.data.accessToken as string;
      const a = await newFlat();
      const d = (await createDiscount({ flatId: a.flatId, type: 'FIXED', value: 100, reason: 'Mine', effectiveFrom: '2044-01-01' }).expect(201)).body.data;
      await http().patch(`/api/v1/billing/flat-discounts/${d.id}`).set(auth(otherToken)).send({ isActive: false }).expect(404);
      await http().delete(`/api/v1/billing/flat-discounts/${d.id}`).set(auth(otherToken)).expect(404);
      await createDiscount({ flatId: a.flatId, type: 'FIXED', value: 1, reason: 'Theirs', effectiveFrom: '2044-01-01' }, otherToken).expect(404);
      await prisma.society.update({ where: { id: other.body.data.memberships[0].societyId }, data: { deletedAt: new Date() } });
    });
  });

  /* ───────────────── correcting a locked opening balance ───────────────── */

  describe('correcting an opening balance', () => {
    async function paidOpening(owed: number, paid: number) {
      const a = await newFlat();
      await saveOpening([{ flatCode: a.code, amount: owed }]).expect(201);
      const bill = await openingBill(a.flatId);
      const sub = await submitPayment(a.token, bill.id, paid).expect(201);
      await approve(sub.body.data.id).expect(201);
      return { ...a, billId: bill.id };
    }

    it('lowers it to more than was paid: the flat just owes less', async () => {
      const a = await paidOpening(5000, 2000);
      const res = await correct(a.flatId, { amount: 3500, reason: 'Ledger page misread' }).expect(201);
      expect(res.body.data).toMatchObject({ previous: '5000', amount: '3500', movedToAdvance: '0' });
      const bill = await openingBill(a.flatId);
      expect(bill.totalAmount.toString()).toBe('3500');
      expect(bill.paidAmount.toString()).toBe('2000');
      expect(bill.pendingAmount.toString()).toBe('1500');
      expect(bill.isPaid).toBe(false);
      expect((await flatRow(a.flatId)).creditBalance.toString()).toBe('0');
    });

    it('lowers it below what was paid: the overpaid money becomes the flat\'s advance, and the bill is settled', async () => {
      const a = await paidOpening(5000, 4000);
      await correct(a.flatId, { amount: 3000, reason: 'Two flats were swapped in the ledger' }).expect(201);
      const bill = await openingBill(a.flatId);
      expect(bill.totalAmount.toString()).toBe('3000');
      expect(bill.paidAmount.toString()).toBe('3000');
      expect(bill.pendingAmount.toString()).toBe('0');
      expect(bill.isPaid).toBe(true);
      expect((await flatRow(a.flatId)).creditBalance.toString()).toBe('1000');
      const entry = await prisma.flatCreditEntry.findFirstOrThrow({ where: { flatId: a.flatId, kind: 'CORRECTION' } });
      expect(entry.amount.toString()).toBe('1000');
    });

    it('raises it: a bill that was paid is owing again', async () => {
      const a = await paidOpening(2000, 2000);
      expect((await openingBill(a.flatId)).isPaid).toBe(true);
      await correct(a.flatId, { amount: 2600, reason: 'A month had been left out' }).expect(201);
      const bill = await openingBill(a.flatId);
      expect(bill.isPaid).toBe(false);
      expect(bill.pendingAmount.toString()).toBe('600');
    });

    it('keeps the period totals right, and writes the old and new amounts and the reason to the audit trail', async () => {
      const a = await paidOpening(1000, 400);
      await correct(a.flatId, { amount: 800, reason: 'Audit me' }).expect(201);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { societyId, entityId: a.billId, action: 'BILL_MODIFIED' }, orderBy: { createdAt: 'desc' } });
      expect(audit.newValues).toMatchObject({ openingBalanceCorrected: true, openingBalance: '800', reason: 'Audit me', flat: a.code });
      expect(audit.oldValues).toMatchObject({ openingBalance: '1000', paid: '400' });

      const period = await prisma.billingPeriod.findFirstOrThrow({ where: { societyId, kind: 'OPENING' } });
      const sums = await prisma.maintenanceBill.aggregate({ where: { billingPeriodId: period.id }, _sum: { totalAmount: true, paidAmount: true, pendingAmount: true } });
      expect(period.totalBilled.toString()).toBe(sums._sum.totalAmount!.toString());
      expect(period.totalCollected.toString()).toBe(sums._sum.paidAmount!.toString());
      expect(period.totalPending.toString()).toBe(sums._sum.pendingAmount!.toString());
    });

    it('refuses a flat with no opening balance, no change, a bad amount, no reason, and anyone but the admin', async () => {
      const none = await newFlat();
      await correct(none.flatId, { amount: 100, reason: 'There is none' }).expect(404);
      const a = await paidOpening(900, 100);
      expect(messageOf((await correct(a.flatId, { amount: 900, reason: 'Same amount' }).expect(400)).body)).toMatch(/already that amount/i);
      await correct(a.flatId, { amount: 0, reason: 'Zero' }).expect(400);
      await correct(a.flatId, { amount: 500 }).expect(400);
      await correct(a.flatId, { amount: 500, reason: 'ok' }).expect(400);
      await correct(a.flatId, { amount: 500, reason: 'Accountant tries' }, accountant).expect(403);
      await correct(a.flatId, { amount: 500, reason: 'Resident tries' }, a.token).expect(403);
      expect((await openingBill(a.flatId)).totalAmount.toString()).toBe('900');
    });
  });

  /* ─────────────────────────── refunding an advance ─────────────────────────── */

  describe('refunding an advance', () => {
    async function flatWithAdvance(advance: number) {
      const a = await newFlat();
      await prisma.flat.update({ where: { id: a.flatId }, data: { creditBalance: D(advance) } });
      return a;
    }
    const accountBalance = async () => (await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalance;

    it('lists the flats that hold an advance', async () => {
      const a = await flatWithAdvance(1234.5);
      const res = (await http().get('/api/v1/billing/advance-credits').set(auth(admin)).expect(200)).body.data;
      expect(res.flats.find((f: any) => f.flatId === a.flatId)).toMatchObject({ flatCode: a.code, balance: '1234.5' });
      expect(parseFloat(res.total)).toBeGreaterThanOrEqual(1234.5);
    });

    it('takes the money out of the credit, the account and the ledger together, and says so in the audit trail', async () => {
      const a = await flatWithAdvance(2000);
      const before = await accountBalance();
      const res = await refund({ flatId: a.flatId, amount: 750, accountId, reason: 'Resident asked for it back', referenceNumber: 'UTR-REF-1' }).expect(201);
      expect(res.body.data).toMatchObject({ flatCode: a.code, refunded: '750', remaining: '1250' });

      expect((await flatRow(a.flatId)).creditBalance.toString()).toBe('1250');
      expect((await accountBalance()).toString()).toBe(before.minus(750).toString());
      const tx = await prisma.transaction.findFirstOrThrow({ where: { societyId, linkedEntityType: 'ADVANCE_REFUND', linkedEntityId: a.flatId } });
      expect(tx).toMatchObject({ transactionType: 'DEBIT', reference: 'UTR-REF-1' });
      expect(tx.amount.toString()).toBe('750');
      expect(tx.balanceAfter.toString()).toBe(before.minus(750).toString());
      const entry = await prisma.flatCreditEntry.findFirstOrThrow({ where: { flatId: a.flatId, kind: 'REFUND' } });
      expect(entry.amount.toString()).toBe('-750');
      expect(await prisma.auditLog.count({ where: { societyId, entityType: 'AdvanceRefund', entityId: a.flatId } })).toBe(1);
    });

    it('can pay the whole advance back, leaving none', async () => {
      const a = await flatWithAdvance(300);
      await refund({ flatId: a.flatId, amount: 300, accountId, reason: 'Moving out' }).expect(201);
      expect((await flatRow(a.flatId)).creditBalance.toString()).toBe('0');
    });

    it('refuses more than the flat holds, and changes nothing', async () => {
      const a = await flatWithAdvance(500);
      const before = await accountBalance();
      const res = await refund({ flatId: a.flatId, amount: 500.01, accountId, reason: 'Too much' }).expect(400);
      expect(messageOf(res.body)).toMatch(/holds only ₹500/);
      expect((await flatRow(a.flatId)).creditBalance.toString()).toBe('500');
      expect((await accountBalance()).toString()).toBe(before.toString());
      expect(await prisma.transaction.count({ where: { societyId, linkedEntityType: 'ADVANCE_REFUND', linkedEntityId: a.flatId } })).toBe(0);
    });

    it('refuses when the account does not hold the money, and changes nothing', async () => {
      const a = await flatWithAdvance(900);
      const poor = await prisma.account.create({ data: { societyId, name: 'Petty cash', accountType: 'CASH', currentBalance: D(100) } });
      const res = await refund({ flatId: a.flatId, amount: 900, accountId: poor.id, reason: 'Cash box is short' }).expect(400);
      expect(messageOf(res.body)).toMatch(/Petty cash holds only ₹100/);
      expect((await flatRow(a.flatId)).creditBalance.toString()).toBe('900');
      expect((await prisma.account.findUniqueOrThrow({ where: { id: poor.id } })).currentBalance.toString()).toBe('100');
    });

    it('refuses a missing flat or account, bad input, and anyone but the admin', async () => {
      const a = await flatWithAdvance(400);
      const ok = { flatId: a.flatId, amount: 100, accountId, reason: 'A fine reason' };
      await refund({ ...ok, flatId: '00000000-0000-4000-8000-000000000000' }).expect(404);
      await refund({ ...ok, accountId: '00000000-0000-4000-8000-000000000000' }).expect(404);
      await refund({ ...ok, amount: 0 }).expect(400);
      await refund({ ...ok, amount: -1 }).expect(400);
      await refund({ ...ok, reason: 'no' }).expect(400);
      await refund(ok, accountant).expect(403);
      await refund(ok, a.token).expect(403);
      expect((await flatRow(a.flatId)).creditBalance.toString()).toBe('400');
    });

    it('refunds an advance exactly once however many refunds are made at the same moment', async () => {
      const a = await flatWithAdvance(1000);
      const before = await accountBalance();
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => refund({ flatId: a.flatId, amount: 600, accountId, reason: 'Race' })));
      // 1000 holds one refund of 600, not two.
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 400)).toHaveLength(4);
      expect((await flatRow(a.flatId)).creditBalance.toString()).toBe('400');
      expect((await accountBalance()).toString()).toBe(before.minus(600).toString());
      expect(await prisma.transaction.count({ where: { societyId, linkedEntityType: 'ADVANCE_REFUND', linkedEntityId: a.flatId } })).toBe(1);
    });
  });
});
