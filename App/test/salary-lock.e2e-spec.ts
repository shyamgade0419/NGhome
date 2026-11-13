/**
 * Closing a month closes its salaries too — on a REAL Postgres.
 *
 * What a fake cannot prove: once a billing month is closed, a salary for that month, or any month before it, can no longer
 * be processed, changed or paid (and no money moves), while the month after stays open; the list marks each record locked
 * and the lock endpoint says how far the books are closed; an employee's own details stay editable; and one society's
 * closing never reaches another's.
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

describe('Salary lock on closed months (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http_ = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  interface Soc { id: string; admin: string; accountId: string; employeeId: string }
  let A: Soc;
  let B: Soc;

  async function register(label: string, n: number): Promise<Soc> {
    const ph = '91' + RUN + String(n).padStart(3, '0');
    const reg = await http_().post('/api/v1/auth/register-society').send({
      society: { name: `E2E SalLock ${label} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: email(`soc-${label}`), contactPhone: ph },
      admin: { firstName: label, lastName: 'Admin', email: email(`admin-${label}`), phone: ph, password: PASSWORD },
    }).expect(201);
    const id = reg.body.data.memberships[0].societyId as string;
    const token = reg.body.data.accessToken as string;
    const account = await prisma.account.create({ data: { societyId: id, name: 'Main account', accountType: 'CURRENT', openingBalance: 1_000_000, currentBalance: 1_000_000 } });
    const employee = (await http_().post('/api/v1/salaries/employees').set(auth(token)).send({ name: 'Watchman', designation: 'Security', baseSalary: 12000 }).expect(201)).body.data;
    return { id, admin: token, accountId: account.id, employeeId: employee.id as string };
  }

  const closeMonth = (societyId: string, month: number, kind: 'REGULAR' | 'OPENING' = 'REGULAR') =>
    prisma.billingPeriod.create({
      data: { societyId, periodYear: YEAR, periodMonth: month, kind, startDate: new Date(YEAR, month - 1, 1), endDate: new Date(YEAR, month - 1, 28), dueDate: new Date(YEAR, month - 1, 10), status: 'CLOSED' },
    });

  const process_ = (soc: Soc, month: number, extra: Record<string, unknown> = {}) =>
    http_().post('/api/v1/salaries/process').set(auth(soc.admin)).send({ employeeId: soc.employeeId, salaryMonth: month, salaryYear: YEAR, accountId: soc.accountId, ...extra });
  const pay = (soc: Soc, id: string) => http_().post(`/api/v1/salaries/${id}/pay`).set(auth(soc.admin));
  const records = async (soc: Soc) => (await http_().get('/api/v1/salaries/records').set(auth(soc.admin)).expect(200)).body.data as Array<{ id: string; salaryMonth: number; salaryYear: number; status: string; locked: boolean }>;
  const balance = async (soc: Soc) => Number((await prisma.account.findUniqueOrThrow({ where: { id: soc.accountId } })).currentBalance);

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
    await prisma.society.updateMany({ where: { name: { contains: 'E2E SalLock' }, AND: { name: { contains: String(UNIQUE) } } }, data: { deletedAt: new Date() } });
    await app.close();
  });

  let sepId: string;
  let octId: string;
  let novId: string;

  it('lets salaries be processed and paid while no month is closed', async () => {
    sepId = (await process_(A, 9).expect(201)).body.data.id;
    octId = (await process_(A, 10).expect(201)).body.data.id;
    novId = (await process_(A, 11).expect(201)).body.data.id;
    await process_(A, 10, { additions: 500 }).expect(201); // a draft can still be reworked
    await pay(A, octId).expect(201);
    expect((await records(A)).every((r) => r.locked === false)).toBe(true);
    expect((await http_().get('/api/v1/salaries/lock').set(auth(A.admin)).expect(200)).body.data.lockedThrough).toBeNull();
    expect(await balance(A)).toBe(1_000_000 - 12_500);
  });

  describe('once October is closed', () => {
    beforeAll(async () => { await closeMonth(A.id, 10); });

    it('says how far the books are closed, and marks each record', async () => {
      expect((await http_().get('/api/v1/salaries/lock').set(auth(A.admin)).expect(200)).body.data.lockedThrough).toEqual({ year: YEAR, month: 10 });
      const byMonth = Object.fromEntries((await records(A)).map((r) => [r.salaryMonth, r.locked]));
      expect(byMonth[9]).toBe(true); // September was never closed on its own: closing October closes it too
      expect(byMonth[10]).toBe(true);
      expect(byMonth[11]).toBe(false);
    });

    it('will not pay a salary for a closed month, and moves no money', async () => {
      const before = await balance(A);
      const r = await pay(A, sepId).expect(403);
      expect(JSON.stringify(r.body)).toMatch(/closed up to October 2026/);
      expect(await balance(A)).toBe(before);
      expect((await prisma.salaryRecord.findUniqueOrThrow({ where: { id: sepId } })).status).not.toBe('PAID');
    });

    it('will not process or rework a salary for a closed month, or for any month before one', async () => {
      for (const month of [10, 9, 3]) {
        const r = await process_(A, month, { additions: 100 }).expect(403);
        expect(JSON.stringify(r.body)).toMatch(/closed up to October 2026/);
      }
      expect(await process_(A, 9).expect(403)).toBeTruthy();
      const rows = await prisma.salaryRecord.findMany({ where: { societyId: A.id, salaryMonth: 3 } });
      expect(rows).toHaveLength(0); // nothing was created for the earlier month
      const sep = await prisma.salaryRecord.findUniqueOrThrow({ where: { id: sepId } });
      expect(Number(sep.additions)).toBe(0); // and the closed draft was not reworked
    });

    it('still answers a retry of a payment that already went through', async () => {
      const again = await pay(A, octId).expect(201);
      expect(again.body.data.status).toBe('PAID');
      expect(await balance(A)).toBe(1_000_000 - 12_500);
    });

    it('keeps the next month fully open: process, rework and pay', async () => {
      await process_(A, 11, { additions: 250 }).expect(201);
      await pay(A, novId).expect(201);
      expect(await balance(A)).toBe(1_000_000 - 12_500 - 12_250);
      await process_(A, 12).expect(201);
    });

    it('leaves an employee\'s own details alone: a new employee can still be added', async () => {
      await http_().post('/api/v1/salaries/employees').set(auth(A.admin)).send({ name: 'Gardener', designation: 'Garden', baseSalary: 8000 }).expect(201);
    });
  });

  describe('another society', () => {
    it('is not locked by this one closing a month', async () => {
      const id = (await process_(B, 10).expect(201)).body.data.id;
      await pay(B, id).expect(201);
      expect((await http_().get('/api/v1/salaries/lock').set(auth(B.admin)).expect(200)).body.data.lockedThrough).toBeNull();
    });

    it('is locked by its own closing, and only up to its own month', async () => {
      await closeMonth(B.id, 9);
      await process_(B, 9).expect(403);
      await process_(B, 11).expect(201);
    });
  });

  describe('the opening period', () => {
    it('is dues carried over, not a month: closing it locks no salary', async () => {
      const C = await register('Charlie', 3);
      await closeMonth(C.id, 12, 'OPENING');
      expect((await http_().get('/api/v1/salaries/lock').set(auth(C.admin)).expect(200)).body.data.lockedThrough).toBeNull();
      await process_(C, 6).expect(201);
    });
  });
});
