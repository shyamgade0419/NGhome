/**
 * Closing a month closes its books — on a REAL Postgres.
 *
 * What a fake cannot prove: once a billing month is closed, an expense dated in that month, or in any month before it, can
 * no longer be added, changed, approved, rejected, paid or deleted, while the month after stays fully open; the line is drawn
 * at midnight India time; the list says which expenses are locked and how far the books are closed; the month filter returns
 * just that month; and one society's closing never reaches another's.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(180_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const RUN = String(Math.floor(10000 + Math.random() * 89999));
const email = (label: string) => `${label}-${UNIQUE}@test.example`.toLowerCase();
const YEAR = 2026;

describe('Expense lock on closed months (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http_ = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  interface Soc { id: string; admin: string; accountId: string }
  let A: Soc;
  let B: Soc;

  async function register(label: string, n: number): Promise<Soc> {
    const ph = '91' + RUN + String(n).padStart(3, '0');
    const reg = await http_().post('/api/v1/auth/register-society').send({
      society: { name: `E2E Lock ${label} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: email(`soc-${label}`), contactPhone: ph },
      admin: { firstName: label, lastName: 'Admin', email: email(`admin-${label}`), phone: ph, password: PASSWORD },
    }).expect(201);
    const id = reg.body.data.memberships[0].societyId as string;
    const account = await prisma.account.create({ data: { societyId: id, name: 'Main account', accountType: 'CURRENT', openingBalance: 1_000_000, currentBalance: 1_000_000 } });
    return { id, admin: reg.body.data.accessToken as string, accountId: account.id };
  }

  const closeMonth = (societyId: string, month: number, kind: 'REGULAR' | 'OPENING' = 'REGULAR') =>
    prisma.billingPeriod.create({
      data: { societyId, periodYear: YEAR, periodMonth: month, kind, startDate: new Date(YEAR, month - 1, 1), endDate: new Date(YEAR, month - 1, 28), dueDate: new Date(YEAR, month - 1, 10), status: 'CLOSED' },
    });

  const add = (soc: Soc, body: Record<string, unknown>) =>
    http_().post('/api/v1/expenses').set(auth(soc.admin)).send({ description: 'Lift service', amount: 1000, ...body });
  const create = async (soc: Soc, date: string, extra: Record<string, unknown> = {}) =>
    (await add(soc, { expenseDate: date, ...extra }).expect(201)).body.data.id as string;
  const list = (soc: Soc, query = '') => http_().get(`/api/v1/expenses?limit=100${query}`).set(auth(soc.admin)).expect(200);

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
    A = await register('Alpha', 1);
    B = await register('Bravo', 2);
  });

  afterAll(async () => {
    await prisma.society.updateMany({ where: { name: { contains: 'E2E Lock' }, AND: { name: { contains: String(UNIQUE) } } }, data: { deletedAt: new Date() } });
    await app.close();
  });

  let octPending: string;
  let octApproved: string;
  let octPaid: string;
  let sepPending: string;
  let novPending: string;

  it('lets everything happen while no month is closed', async () => {
    octPending = await create(A, `${YEAR}-10-12T00:00:00.000Z`);
    octApproved = await create(A, `${YEAR}-10-14T00:00:00.000Z`);
    octPaid = await create(A, `${YEAR}-10-16T00:00:00.000Z`);
    sepPending = await create(A, `${YEAR}-09-20T00:00:00.000Z`);
    novPending = await create(A, `${YEAR}-11-05T00:00:00.000Z`);
    await http_().post(`/api/v1/expenses/${octApproved}/approve`).set(auth(A.admin)).expect(201);
    await http_().post(`/api/v1/expenses/${octPaid}/approve`).set(auth(A.admin)).expect(201);
    await http_().post(`/api/v1/expenses/${octPaid}/mark-paid`).set(auth(A.admin)).send({ accountId: A.accountId }).expect(201);
    await http_().patch(`/api/v1/expenses/${octPending}`).set(auth(A.admin)).send({ description: 'Lift service (changed)' }).expect(200);

    const res = (await list(A)).body;
    expect(res.data.every((e: any) => e.locked === false)).toBe(true);
    expect(res.meta.lockedThrough).toBeNull();
  });

  describe('once October is closed', () => {
    beforeAll(async () => { await closeMonth(A.id, 10); });

    it('says how far the books are closed, and marks each expense', async () => {
      const res = (await list(A)).body;
      expect(res.meta.lockedThrough).toEqual({ year: YEAR, month: 10 });
      const byId = Object.fromEntries(res.data.map((e: any) => [e.id, e.locked]));
      expect(byId[octPending]).toBe(true);
      expect(byId[octApproved]).toBe(true);
      expect(byId[octPaid]).toBe(true);
      expect(byId[sepPending]).toBe(true); // September was never closed on its own: closing October closes it too
      expect(byId[novPending]).toBe(false);
      const one = (await http_().get(`/api/v1/expenses/${octPending}`).set(auth(A.admin)).expect(200)).body.data;
      expect(one).toMatchObject({ locked: true, lockedThrough: { year: YEAR, month: 10 } });
    });

    it('refuses to approve, reject, pay, change or delete an expense in a closed month, and says why', async () => {
      const refused = async (res: request.Test) => {
        const r = await res.expect(403);
        expect(JSON.stringify(r.body)).toMatch(/closed up to October 2026/);
      };
      await refused(http_().post(`/api/v1/expenses/${octPending}/approve`).set(auth(A.admin)));
      await refused(http_().post(`/api/v1/expenses/${octPending}/reject`).set(auth(A.admin)).send({ reason: 'No bill' }));
      await refused(http_().post(`/api/v1/expenses/${octPending}/mark-paid`).set(auth(A.admin)).send({ accountId: A.accountId }));
      await refused(http_().patch(`/api/v1/expenses/${octPending}`).set(auth(A.admin)).send({ description: 'Edited after closing' }));
      await refused(http_().delete(`/api/v1/expenses/${octPending}`).set(auth(A.admin)));
      // an approved and a paid one cannot be corrected either, with a reason or without
      await refused(http_().patch(`/api/v1/expenses/${octApproved}`).set(auth(A.admin)).send({ amount: 1, reason: 'Typo' }));
      await refused(http_().patch(`/api/v1/expenses/${octPaid}`).set(auth(A.admin)).send({ amount: 1, reason: 'Typo' }));
      // and an earlier month, never closed by itself, is locked as well
      await refused(http_().delete(`/api/v1/expenses/${sepPending}`).set(auth(A.admin)));
    });

    it('left the closed expenses exactly as they were', async () => {
      const rows = await prisma.expense.findMany({ where: { id: { in: [octPending, octApproved, octPaid, sepPending] } } });
      const by = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(by[octPending].status).toBe('PENDING');
      expect(by[octPending].description).toBe('Lift service (changed)'); // the change made before closing stays
      expect(by[octApproved].status).toBe('APPROVED');
      expect(Number(by[octApproved].amount)).toBe(1000);
      expect(by[octPaid].status).toBe('PAID');
      expect(Number(by[octPaid].amount)).toBe(1000);
      expect(by[sepPending].status).toBe('PENDING');
    });

    it('will not add an expense dated in a closed month or before one', async () => {
      for (const date of [`${YEAR}-10-20T00:00:00.000Z`, `${YEAR}-10-31T10:00:00.000Z`, `${YEAR}-08-01T00:00:00.000Z`]) {
        const r = await add(A, { expenseDate: date }).expect(403);
        expect(JSON.stringify(r.body)).toMatch(/closed up to October 2026/);
      }
    });

    it('draws the line at midnight in India', async () => {
      await add(A, { expenseDate: '2026-10-31T18:29:00.000Z' }).expect(403); // 11:59 pm on 31 October in India
      const id = await create(A, '2026-10-31T18:31:00.000Z'); // 12:01 am on 1 November in India
      expect((await list(A)).body.data.find((e: any) => e.id === id).locked).toBe(false);
    });

    it('keeps the next month fully open: add, change, approve, pay, delete', async () => {
      await http_().patch(`/api/v1/expenses/${novPending}`).set(auth(A.admin)).send({ description: 'November, changed' }).expect(200);
      await http_().post(`/api/v1/expenses/${novPending}/approve`).set(auth(A.admin)).expect(201);
      await http_().post(`/api/v1/expenses/${novPending}/mark-paid`).set(auth(A.admin)).send({ accountId: A.accountId }).expect(201);
      const another = await create(A, `${YEAR}-11-20T00:00:00.000Z`);
      await http_().delete(`/api/v1/expenses/${another}`).set(auth(A.admin)).expect(200);
    });

    it('will not move an open expense into a closed month', async () => {
      const id = await create(A, `${YEAR}-11-25T00:00:00.000Z`);
      const r = await http_().patch(`/api/v1/expenses/${id}`).set(auth(A.admin)).send({ expenseDate: `${YEAR}-10-05T00:00:00.000Z` }).expect(403);
      expect(JSON.stringify(r.body)).toMatch(/closed up to October 2026/);
    });

    it('returns just the month asked for, and ignores a month it cannot read', async () => {
      const nov = (await list(A, `&year=${YEAR}&month=11`)).body;
      expect(nov.data.length).toBeGreaterThan(0);
      expect(nov.data.every((e: any) => e.locked === false)).toBe(true);
      const oct = (await list(A, `&year=${YEAR}&month=10`)).body;
      const ids = oct.data.map((e: any) => e.id);
      expect(ids).toEqual(expect.arrayContaining([octPending, octApproved, octPaid]));
      expect(ids).not.toContain(sepPending);
      expect(ids).not.toContain(novPending);
      expect(oct.data.every((e: any) => e.locked === true)).toBe(true);
      const all = (await list(A, '&year=abc&month=99')).body;
      expect(all.data.length).toBeGreaterThan(oct.data.length); // a bad month is no filter
      // status still narrows inside a month
      const paidOct = (await list(A, `&year=${YEAR}&month=10&status=PAID`)).body;
      expect(paidOct.data.map((e: any) => e.id)).toEqual([octPaid]);
    });
  });

  describe('another society', () => {
    it('is not locked by this one closing a month', async () => {
      const id = await create(B, `${YEAR}-10-12T00:00:00.000Z`);
      await http_().post(`/api/v1/expenses/${id}/approve`).set(auth(B.admin)).expect(201);
      expect((await list(B)).body.meta.lockedThrough).toBeNull();
    });

    it('is locked by its own closing, and only up to its own month', async () => {
      await closeMonth(B.id, 9);
      const meta = (await list(B)).body.meta;
      expect(meta.lockedThrough).toEqual({ year: YEAR, month: 9 });
      await add(B, { expenseDate: `${YEAR}-09-30T00:00:00.000Z` }).expect(403);
      await add(B, { expenseDate: `${YEAR}-10-01T06:00:00.000Z` }).expect(201);
    });
  });

  describe('the opening period', () => {
    it('is dues carried over, not a month: closing it locks nothing', async () => {
      const C = await register('Charlie', 3);
      await closeMonth(C.id, 12, 'OPENING');
      expect((await list(C)).body.meta.lockedThrough).toBeNull();
      await add(C, { expenseDate: `${YEAR}-06-01T00:00:00.000Z` }).expect(201);
    });
  });
});
