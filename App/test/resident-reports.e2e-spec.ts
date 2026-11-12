/**
 * The society-wide reports a resident can read — on a REAL Postgres.
 *
 * What a fake cannot prove: both reports are closed to residents until the admin switches them on, a draft period
 * never reaches a resident, the figures are the real ones for the month asked for, nothing names a flat or a person,
 * the switch survives other settings being saved, and one society's choice never reaches another's.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(120_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const RUN = String(Math.floor(10000 + Math.random() * 89999));
const email = (label: string) => `${label}-${UNIQUE}@test.example`.toLowerCase();

describe('Resident reports (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http_ = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  interface Soc { id: string; admin: string; resident: string; adminId: string }
  let A: Soc;
  let B: Soc;

  async function registerSociety(label: string, n: number): Promise<Soc> {
    const ph = '91' + RUN + String(n).padStart(3, '0');
    const reg = await http_().post('/api/v1/auth/register-society').send({
      society: { name: `E2E Rep ${label} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: email(`soc-${label}`), contactPhone: ph },
      admin: { firstName: label, lastName: 'Admin', email: email(`admin-${label}`), phone: ph, password: PASSWORD },
    }).expect(201);
    const id = reg.body.data.memberships[0].societyId as string;
    const user = await prisma.user.create({ data: { email: email(`res-${label}`), firstName: label, lastName: 'Res', phone: '92' + RUN + String(n).padStart(3, '0'), passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true } });
    await prisma.societyMembership.create({ data: { societyId: id, userId: user.id, role: 'RESIDENT', status: 'ACTIVE', isPrimary: true } });
    const resident = (await http_().post('/api/v1/auth/login').send({ identifier: email(`res-${label}`), password: PASSWORD }).expect(200)).body.data.accessToken as string;
    const adminUser = await prisma.user.findFirst({ where: { email: email(`admin-${label}`) } });
    return { id, admin: reg.body.data.accessToken as string, resident, adminId: adminUser!.id };
  }

  const collection = (t: string, year: number, month: number) => http_().get(`/api/v1/societies/my/reports/collection?year=${year}&month=${month}`).set(auth(t));
  const expenses = (t: string, year: number, month: number) => http_().get(`/api/v1/societies/my/reports/expenses?year=${year}&month=${month}`).set(auth(t));
  const change = (t: string, body: Record<string, unknown>) => http_().patch('/api/v1/societies/my/config').set(auth(t)).send(body);

  const period = (societyId: string, year: number, month: number, status: any, billed: number, collected: number) =>
    prisma.billingPeriod.create({
      data: { societyId, periodYear: year, periodMonth: month, startDate: new Date(year, month - 1, 1), endDate: new Date(year, month - 1, 28), dueDate: new Date(year, month - 1, 10), status, totalBilled: billed, totalCollected: collected, totalPending: billed - collected },
    });

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
    A = await registerSociety('Alpha', 1);
    B = await registerSociety('Bravo', 2);
  });

  afterAll(async () => {
    await prisma.society.updateMany({ where: { name: { contains: 'E2E Rep' }, AND: { name: { contains: String(UNIQUE) } } }, data: { deletedAt: new Date() } });
    await app.close();
  });

  describe('collection summary', () => {
    it('is closed to a resident until the admin switches it on', async () => {
      await period(A.id, 2026, 9, 'PUBLISHED', 28000, 28000);
      const res = (await collection(A.resident, 2026, 9).expect(200)).body.data;
      expect(res).toEqual({ enabled: false, year: 2026, month: 9 });
    });

    it('gives the real figures for the month once switched on, with no flat or name in them', async () => {
      await change(A.admin, { showCollectionToResidents: true }).expect(200);
      const res = (await collection(A.resident, 2026, 9).expect(200)).body.data;
      expect(res).toMatchObject({ enabled: true, found: true, year: 2026, month: 9, status: 'PUBLISHED', totalBilled: 28000, totalCollected: 28000, totalPending: 0, collectionRate: 100 });
      expect(Object.keys(res).sort()).toEqual(['collectionRate', 'dueDate', 'enabled', 'flatsBilled', 'flatsPaid', 'found', 'month', 'status', 'totalBilled', 'totalCollected', 'totalPending', 'year']);
    });

    it('works out the collection rate to one decimal place', async () => {
      await period(A.id, 2026, 10, 'PARTIALLY_PAID', 71820.04, 31654.37);
      const res = (await collection(A.resident, 2026, 10).expect(200)).body.data;
      expect(res).toMatchObject({ found: true, totalBilled: 71820.04, totalCollected: 31654.37, collectionRate: 44.1 });
    });

    it('never shows a draft period, and says so for a month with no period', async () => {
      await period(A.id, 2026, 11, 'DRAFT', 5000, 0);
      expect((await collection(A.resident, 2026, 11).expect(200)).body.data).toEqual({ enabled: true, found: false, year: 2026, month: 11 });
      expect((await collection(A.resident, 2026, 1).expect(200)).body.data).toEqual({ enabled: true, found: false, year: 2026, month: 1 });
    });

    it('survives other settings being saved, and can be switched back off', async () => {
      await change(A.admin, { upiId: 'alpha@upi' }).expect(200);
      expect((await collection(A.resident, 2026, 9).expect(200)).body.data.enabled).toBe(true);
      await change(A.admin, { showCollectionToResidents: false }).expect(200);
      expect((await collection(A.resident, 2026, 9).expect(200)).body.data.enabled).toBe(false);
      await change(A.admin, { showCollectionToResidents: true }).expect(200);
    });

    it('does not reach another society, and only an admin can change the switch', async () => {
      await period(B.id, 2026, 9, 'PUBLISHED', 999, 1);
      expect((await collection(B.resident, 2026, 9).expect(200)).body.data.enabled).toBe(false);
      await change(A.resident, { showCollectionToResidents: false }).expect(403);
    });
  });

  describe('expense breakdown', () => {
    it('is closed to a resident until the society shows expenses to residents', async () => {
      expect((await expenses(A.resident, 2026, 10).expect(200)).body.data).toEqual({ enabled: false, year: 2026, month: 10 });
    });

    it('adds up the month by category, staff pay as one line, and leaves out other months and unapproved spending', async () => {
      const cat = await prisma.expenseCategory.create({ data: { societyId: A.id, name: 'Lift repairs' } });
      const cat2 = await prisma.expenseCategory.create({ data: { societyId: A.id, name: 'Garden' } });
      const row = (categoryId: string, amount: number, date: Date, status: any, description = 'x') => ({ societyId: A.id, categoryId, amount, expenseDate: date, status, description, createdById: A.adminId });
      await prisma.expense.createMany({
        data: [
          row(cat.id, 4000, new Date(2026, 9, 5), 'APPROVED'),
          row(cat.id, 1000, new Date(2026, 9, 30), 'PAID'),
          row(cat2.id, 2500, new Date(2026, 9, 12), 'PAID'),
          row(cat2.id, 700, new Date(2026, 9, 14), 'PENDING'), // not approved
          row(cat2.id, 900, new Date(2026, 8, 30), 'PAID'), // September
          row(cat2.id, 800, new Date(2026, 10, 1), 'PAID'), // November
        ],
      });
      const guard = await prisma.societyEmployee.create({ data: { societyId: A.id, name: 'Watchman', designation: 'Security', baseSalary: 6000 } });
      await prisma.salaryRecord.createMany({
        data: [
          { societyId: A.id, employeeId: guard.id, salaryMonth: 10, salaryYear: 2026, baseSalary: 6000, netSalary: 6000, status: 'PAID' },
          { societyId: A.id, employeeId: guard.id, salaryMonth: 9, salaryYear: 2026, baseSalary: 6000, netSalary: 6000, status: 'PAID' }, // another month
        ],
      });

      await change(A.admin, { showExpensesToResidents: true }).expect(200);
      const res = (await expenses(A.resident, 2026, 10).expect(200)).body.data;
      expect(res.enabled).toBe(true);
      const byName = Object.fromEntries(res.byCategory.map((c: any) => [c.category, c.total]));
      expect(byName['Lift repairs']).toBe(5000);
      expect(byName['Garden']).toBe(2500);
      expect(byName['Staff Salaries']).toBe(6000); // October only, as one line
      expect(res.count).toBe(3); // the expense rows; salaries are not expenses
      expect(res.byCategory[0].total).toBeGreaterThanOrEqual(res.byCategory[res.byCategory.length - 1].total);
      expect(res.total).toBe(Object.values(byName).reduce((a: number, b) => a + (b as number), 0));
      expect(JSON.stringify(res)).not.toContain('Alpha'); // no names
    });

    it('falls back to this month for a bad year or month, rather than failing', async () => {
      const res = await http_().get('/api/v1/societies/my/reports/expenses?year=abc&month=99').set(auth(A.resident)).expect(200);
      const now = new Date();
      expect(res.body.data).toMatchObject({ enabled: true, year: now.getFullYear(), month: now.getMonth() + 1 });
    });

    it('does not reach another society', async () => {
      expect((await expenses(B.resident, 2026, 10).expect(200)).body.data.enabled).toBe(false);
    });
  });
});
