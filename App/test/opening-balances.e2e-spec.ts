/**
 * Opening balances — dues a flat carried over from paper or Excel — against a REAL Postgres, through
 * real HTTP.
 *
 * What a fake cannot prove: that the opening bills are settled before any real month, show as arrears
 * on the first statement, are never fined, cannot be changed once a payment touched them, stay out of the
 * period lists, and that two people saving the first import at once do not end up with two periods.
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
const LATER = new Date('2041-06-01T06:30:00.000Z');

describe('Opening balances (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let lateFees: LateFeeService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let societyId: string;
  let accountId: string;
  let buildingId: string;
  let flatNo = 0;
  let utrNo = 0;
  let monthNo = 0;

  async function makeUser(label: string, role: SystemRole, flatId: string | null = null): Promise<{ token: string }> {
    const email = `${label}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: { email, firstName: label, lastName: 'Test', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId, role, status: 'ACTIVE', isPrimary: role === SystemRole.RESIDENT } });
    const login = await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200);
    return { token: login.body.data.accessToken as string };
  }

  /** A flat coded O-<n> with a resident who can pay. */
  async function newFlat() {
    flatNo += 1;
    const code = `O-${flatNo}`;
    const flatId = (await http().post('/api/v1/flats').set(auth(admin)).send({ buildingId, unitNumber: `${flatNo}`, flatCode: code }).expect(201)).body.data.id as string;
    const res = await makeUser(`ores${flatNo}`, SystemRole.RESIDENT, flatId);
    return { flatId, code, token: res.token };
  }

  /** A published month in 2040 with a bill for the flat. */
  async function monthWithBill(flatId: string, amount: number) {
    monthNo += 1;
    const year = 2040 + Math.floor((monthNo - 1) / 12);
    const m = ((monthNo - 1) % 12) + 1;
    const mm = String(m).padStart(2, '0');
    const id = (await http().post('/api/v1/billing/periods').set(auth(admin)).send({
      periodYear: year, periodMonth: m, startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-28`, dueDate: `${year}-${mm}-10`,
    }).expect(201)).body.data.id as string;
    await prisma.billingPeriod.update({ where: { id }, data: { status: 'PUBLISHED' } });
    const b = await prisma.maintenanceBill.create({
      data: {
        societyId, billingPeriodId: id, flatId, invoiceNumber: `INV-${UNIQUE}-${monthNo}-${flatId.slice(0, 4)}`, flatCode: 'X',
        baseAmount: D(amount), totalAmount: D(amount), pendingAmount: D(amount), dueDate: new Date(`${year}-${mm}-10`), isPublished: true,
      },
    });
    return { periodId: id, billId: b.id };
  }

  const save = (rows: { flatCode: string; amount: number; note?: string }[], over: Record<string, unknown> = {}, token = admin) =>
    http().post('/api/v1/billing/opening-balances').set(auth(token)).send({ asOfDate: '2026-03-31', rows, ...over });
  const list = (token = admin) => http().get('/api/v1/billing/opening-balances').set(auth(token));
  const rowOf = (body: any, code: string) => body.data.rows.find((r: any) => r.flatCode === code);
  const openingBillOf = (flatId: string) =>
    prisma.maintenanceBill.findFirst({ where: { flatId, billingPeriod: { kind: 'OPENING' } } });

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
      society: { name: `E2E Opening ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-o-${UNIQUE}@test.example`, contactPhone: phone(1) },
      admin: { firstName: 'Admin', lastName: 'O', email: `admin-o-${UNIQUE}@test.example`, phone: phone(1), password: PASSWORD },
    }).expect(201);
    admin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    buildingId = (await http().post('/api/v1/buildings').set(auth(admin)).send({ name: 'O', code: 'O' }).expect(201)).body.data.id;
    accountId = (await prisma.account.create({ data: { societyId, name: 'Main', accountType: 'CURRENT' } })).id;
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
  });

  it('keeps the screen to admins and accountants', async () => {
    const flat = await newFlat();
    await list(flat.token).expect(403);
    await save([{ flatCode: flat.code, amount: 100 }], {}, flat.token).expect(403);
  });

  it('starts empty: every flat listed, none with a balance, no period made', async () => {
    const a = await newFlat();
    const res = await list().expect(200);
    expect(res.body.data.asOfDate).toBeNull();
    expect(res.body.data.totals.withBalance).toBe(0);
    expect(rowOf(res.body, a.code)).toMatchObject({ amount: null, locked: null });
    expect(await prisma.billingPeriod.count({ where: { societyId, kind: 'OPENING' } })).toBe(0);
  });

  it('checks the rows without saving anything on a dry run', async () => {
    const a = await newFlat();
    const res = await save([{ flatCode: a.code, amount: 7000 }, { flatCode: 'NOPE-1', amount: 10 }], { dryRun: true }).expect(201);
    expect(res.body.data.dryRun).toBe(true);
    expect(res.body.data.results.map((r: any) => r.action)).toEqual(['CREATE', 'REJECTED']);
    expect(res.body.data.results[1].message).toContain('No flat "NOPE-1"');
    expect(await openingBillOf(a.flatId)).toBeNull();
    expect(await prisma.billingPeriod.count({ where: { societyId, kind: 'OPENING' } })).toBe(0);
  });

  it('saves balances, skipping the rows that are wrong and keeping the rest', async () => {
    const a = await newFlat();
    const b = await newFlat();
    const res = await save([
      { flatCode: a.code, amount: 12000, note: 'Paper ledger, to March' },
      { flatCode: b.code.toLowerCase().replace('-', ' '), amount: 3500.5 },
      { flatCode: 'MISSING', amount: 1 },
      { flatCode: a.code, amount: 5 },
    ]).expect(201);

    expect(res.body.data.summary).toEqual({ created: 2, updated: 0, removed: 0, unchanged: 0, rejected: 2 });
    const bill = await openingBillOf(a.flatId);
    expect(bill).toMatchObject({ isPublished: true, isPaid: false, notes: 'Paper ledger, to March', invoiceNumber: `OB-${a.code}` });
    expect(bill!.totalAmount.toString()).toBe('12000');
    expect(bill!.pendingAmount.toString()).toBe('12000');
    expect((await openingBillOf(b.flatId))!.totalAmount.toString()).toBe('3500.5');
    const lines = await prisma.billLineItem.findMany({ where: { maintenanceBillId: bill!.id } });
    expect(lines).toMatchObject([{ componentType: 'OPENING_BALANCE', description: 'Paper ledger, to March' }]);

    const seen = await list().expect(200);
    expect(rowOf(seen.body, a.code)).toMatchObject({ amount: '12000', pendingAmount: '12000', note: 'Paper ledger, to March', locked: null });
    expect(new Date(seen.body.data.asOfDate).toISOString().slice(0, 10)).toBe('2026-03-31');
  });

  it('keeps the opening period out of the period lists and the dashboard', async () => {
    const a = await newFlat();
    await save([{ flatCode: a.code, amount: 100 }]).expect(201);
    const periods = (await http().get('/api/v1/billing/periods').set(auth(admin)).expect(200)).body.data;
    expect((periods.data ?? periods).every((p: any) => p.kind !== 'OPENING' && p.periodYear !== 1970)).toBe(true);
    const published = (await http().get('/api/v1/billing/periods/published').set(auth(admin)).expect(200)).body.data;
    expect(published.every((p: any) => p.periodYear !== 1970)).toBe(true);
    const stats = (await http().get('/api/v1/societies/my/stats').set(auth(admin))).body.data;
    expect(stats?.currentPeriod?.periodYear ?? 2040).not.toBe(1970);
  });

  it('refuses to create a real billing period in the reserved year', async () => {
    await http().post('/api/v1/billing/periods').set(auth(admin)).send({
      periodYear: 1970, periodMonth: 1, startDate: '1970-01-01', endDate: '1970-01-28', dueDate: '1970-01-10',
    }).expect(400);
  });

  it('shows the dues to the resident, labelled as an opening balance, and as arrears on the next statement', async () => {
    const a = await newFlat();
    await save([{ flatCode: a.code, amount: 4000 }]).expect(201);
    const { periodId } = await monthWithBill(a.flatId, 1000);

    const mine = (await http().get('/api/v1/billing/my-bills').set(auth(a.token)).expect(200)).body.data;
    const bills = mine.data ?? mine;
    expect(bills.map((b: any) => b.billingPeriod.kind)).toEqual(['REGULAR', 'OPENING']);

    const stmt = (await http().get(`/api/v1/billing/periods/${periodId}/statement`).set(auth(admin)).expect(200)).body.data;
    const row = stmt.statements.find((s: any) => s.flatId === a.flatId);
    expect(row.arrears).toBe(4000);
    expect(row.totalPayable).toBe(5000);

    const dues = (await http().get('/api/v1/reports/outstanding-dues').set(auth(admin)).expect(200)).body.data;
    expect(dues.bills.filter((x: any) => x.flatCode === a.code || x.invoiceNumber === `OB-${a.code}`).length).toBeGreaterThan(0);
  });

  it('is never fined, however late', async () => {
    await prisma.societyConfiguration.update({ where: { societyId }, data: { lateFeeType: 'FIXED', lateFeeValue: 250, gracePeriodDays: 0 } });
    const a = await newFlat();
    await save([{ flatCode: a.code, amount: 2000 }]).expect(201);
    await lateFees.applyForSociety(societyId, LATER);
    const bill = await openingBillOf(a.flatId);
    expect(bill!.lateFee.toString()).toBe('0');
    expect(bill!.totalAmount.toString()).toBe('2000');
    await prisma.societyConfiguration.update({ where: { societyId }, data: { lateFeeType: null, lateFeeValue: 0 } });
  });

  it('changes an amount and removes a balance while nobody has paid against it', async () => {
    const a = await newFlat();
    await save([{ flatCode: a.code, amount: 5000 }]).expect(201);

    const changed = await save([{ flatCode: a.code, amount: 4200, note: 'Corrected' }]).expect(201);
    expect(changed.body.data.results[0]).toMatchObject({ action: 'UPDATE', previous: '5000', amount: '4200' });
    const bill = await openingBillOf(a.flatId);
    expect(bill).toMatchObject({ notes: 'Corrected' });
    expect(bill!.pendingAmount.toString()).toBe('4200');
    const line = await prisma.billLineItem.findFirstOrThrow({ where: { maintenanceBillId: bill!.id } });
    expect(line.amount.toString()).toBe('4200');

    const same = await save([{ flatCode: a.code, amount: 4200 }]).expect(201);
    expect(same.body.data.results[0].action).toBe('UNCHANGED');

    const removed = await save([{ flatCode: a.code, amount: 0 }]).expect(201);
    expect(removed.body.data.results[0].action).toBe('REMOVE');
    expect(await openingBillOf(a.flatId)).toBeNull();
    expect(await prisma.billLineItem.count({ where: { maintenanceBillId: bill!.id } })).toBe(0);
  });

  it('settles the opening dues before the first real month, then locks them', async () => {
    const a = await newFlat();
    await save([{ flatCode: a.code, amount: 3000 }]).expect(201);
    const { billId } = await monthWithBill(a.flatId, 1000);

    // The resident pays the month's bill, but the payment clears the older opening dues first.
    const sub = await submitPayment(a.token, billId, 3500).expect(201);
    await approve(sub.body.data.id).expect(201);

    const opening = await openingBillOf(a.flatId);
    expect(opening).toMatchObject({ isPaid: true });
    expect(opening!.paidAmount.toString()).toBe('3000');
    expect((await prisma.maintenanceBill.findUniqueOrThrow({ where: { id: billId } })).paidAmount.toString()).toBe('500');

    const seen = await list().expect(200);
    expect(rowOf(seen.body, a.code).locked).toContain('payment has been recorded');

    const edit = await save([{ flatCode: a.code, amount: 100 }]).expect(201);
    expect(edit.body.data.results[0]).toMatchObject({ action: 'REJECTED', message: expect.stringContaining('payment has been recorded') });
    const del = await save([{ flatCode: a.code, amount: 0 }]).expect(201);
    expect(del.body.data.results[0].action).toBe('REJECTED');
    expect((await openingBillOf(a.flatId))!.totalAmount.toString()).toBe('3000');
  });

  it('locks a balance that has a payment waiting for approval, so the payment cannot be orphaned', async () => {
    const a = await newFlat();
    await save([{ flatCode: a.code, amount: 900 }]).expect(201);
    const bill = await openingBillOf(a.flatId);
    await submitPayment(a.token, bill!.id, 900).expect(201);

    const res = await save([{ flatCode: a.code, amount: 0 }]).expect(201);
    expect(res.body.data.results[0]).toMatchObject({ action: 'REJECTED', message: expect.stringContaining('submitted') });
    expect(await openingBillOf(a.flatId)).not.toBeNull();
  });

  it('puts an advance the flat already holds against the balance as it is entered', async () => {
    const a = await newFlat();
    await prisma.flat.update({ where: { id: a.flatId }, data: { creditBalance: D(1500) } });
    await save([{ flatCode: a.code, amount: 4000 }]).expect(201);

    const bill = await openingBillOf(a.flatId);
    expect(bill!.paidAmount.toString()).toBe('1500');
    expect(bill!.pendingAmount.toString()).toBe('2500');
    expect((await prisma.flat.findUniqueOrThrow({ where: { id: a.flatId } })).creditBalance.toString()).toBe('0');
  });

  it('rejects a date in the future and an empty or oversized request', async () => {
    const a = await newFlat();
    await save([{ flatCode: a.code, amount: 10 }], { asOfDate: '2099-01-01' }).expect(400);
    await save([]).expect(400);
    await save([{ flatCode: a.code, amount: -1 }]).expect(400);
    await save([{ flatCode: a.code, amount: 10_000_001 }]).expect(400);
    await http().post('/api/v1/billing/opening-balances').set(auth(admin)).send({ rows: [{ flatCode: a.code, amount: 1 }] }).expect(400);
  });

  it('ends with one opening period however many people save the first balances at once', async () => {
    // A society that has never saved any: the opening period is created by whichever request wins.
    const reg = await http().post('/api/v1/auth/register-society').send({
      society: { name: `E2E Opening Race ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-or-${UNIQUE}@test.example`, contactPhone: phone(2) },
      admin: { firstName: 'Admin', lastName: 'R', email: `admin-or-${UNIQUE}@test.example`, phone: phone(2), password: PASSWORD },
    }).expect(201);
    const token = reg.body.data.accessToken as string;
    const sid = reg.body.data.memberships[0].societyId as string;
    const bid = (await http().post('/api/v1/buildings').set(auth(token)).send({ name: 'R', code: 'R' }).expect(201)).body.data.id;
    const codes: string[] = [];
    for (let i = 1; i <= 6; i++) {
      codes.push(`R-${i}`);
      await http().post('/api/v1/flats').set(auth(token)).send({ buildingId: bid, unitNumber: `${i}`, flatCode: `R-${i}` }).expect(201);
    }

    const rows = codes.map((flatCode) => ({ flatCode, amount: 1000 }));
    const results = await Promise.all([1, 2, 3, 4].map(() => save(rows, {}, token)));
    // Each call either did the work, found it done, or was told to retry — never an error.
    for (const r of results) expect([201, 409]).toContain(r.status);
    expect(results.some((r) => r.status === 201)).toBe(true);

    expect(await prisma.billingPeriod.count({ where: { societyId: sid, kind: 'OPENING' } })).toBe(1);
    expect(await prisma.maintenanceBill.count({ where: { societyId: sid, billingPeriod: { kind: 'OPENING' } } })).toBe(6);
    await prisma.society.update({ where: { id: sid }, data: { deletedAt: new Date() } });
  });
});
