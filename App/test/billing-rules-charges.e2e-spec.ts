/**
 * Setting the maintenance amount and a corpus once, and having every flat's bill pick them up —
 * against a REAL Postgres, through real HTTP.
 *
 * The amount used to be settable nowhere in the apps: a rule made on screen carried no amount and so
 * billed nothing, silently. These tests pin that a rule must carry one, that regular maintenance and a
 * corpus show as separate lines on every flat's bill, and that a corpus paid in instalments stops
 * when its months end.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const phone = (n: number) => '89' + String(UNIQUE).slice(-7) + String(n);

describe('Maintenance and corpus rules (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let societyId: string;
  let flatA: string;
  let flatB: string;

  const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));
  const createRule = (body: Record<string, unknown>) => http().post('/api/v1/billing-rules').set(auth(admin)).send(body);

  async function billsFor(year: number, month: number) {
    const mm = String(month).padStart(2, '0');
    const period = (await http().post('/api/v1/billing/periods').set(auth(admin)).send({
      periodYear: year, periodMonth: month, startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-28`, dueDate: `${year}-${mm}-10`,
    }).expect(201)).body.data.id as string;
    await http().post(`/api/v1/billing/periods/${period}/generate`).set(auth(admin)).expect(201);
    return prisma.maintenanceBill.findMany({ where: { billingPeriodId: period }, include: { lineItems: true }, orderBy: { flatCode: 'asc' } });
  }

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
      society: { name: `E2E Rules ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-r-${UNIQUE}@test.example`, contactPhone: phone(1) },
      admin: { firstName: 'Admin', lastName: 'R', email: `admin-r-${UNIQUE}@test.example`, phone: phone(1), password: PASSWORD },
    }).expect(201);
    admin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    const building = (await http().post('/api/v1/buildings').set(auth(admin)).send({ name: 'R', code: 'R' }).expect(201)).body.data.id;
    flatA = (await http().post('/api/v1/flats').set(auth(admin)).send({ buildingId: building, unitNumber: '1', flatCode: 'R-1', area: 1000 }).expect(201)).body.data.id;
    flatB = (await http().post('/api/v1/flats').set(auth(admin)).send({ buildingId: building, unitNumber: '2', flatCode: 'R-2', area: 1500 }).expect(201)).body.data.id;
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
  });

  describe('a rule must carry an amount', () => {
    it('refuses one with no amount — it would bill nothing for every flat', async () => {
      const res = await createRule({ name: 'Maintenance', calculationType: 'EQUAL_PER_FLAT', effectiveFrom: '2042-01-01T00:00:00.000Z' }).expect(400);
      expect(messageOf(res.body)).toMatch(/amount/i);
      expect(await prisma.billingRule.count({ where: { societyId } })).toBe(0);
    });

    it('refuses a zero or negative amount, and a water rule', async () => {
      await createRule({ name: 'M', calculationType: 'EQUAL_PER_FLAT', effectiveFrom: '2042-01-01T00:00:00.000Z', config: { amount: 0 } }).expect(400);
      await createRule({ name: 'M', calculationType: 'EQUAL_PER_FLAT', effectiveFrom: '2042-01-01T00:00:00.000Z', config: { amount: -10 } }).expect(400);
      const water = await createRule({ name: 'W', calculationType: 'WATER_USAGE_BASED', effectiveFrom: '2042-01-01T00:00:00.000Z', config: { amount: 5 } }).expect(400);
      expect(messageOf(water.body)).toMatch(/Water Billing/);
    });
  });

  describe('regular maintenance and a corpus', () => {
    it('bills every flat the same maintenance, and the corpus as its own line, for exactly the months it runs', async () => {
      await createRule({
        name: 'Monthly maintenance', calculationType: 'EQUAL_PER_FLAT', effectiveFrom: '2042-01-01T00:00:00.000Z',
        config: { amount: 2500, chargeType: 'MAINTENANCE' },
      }).expect(201);
      // A corpus of ₹900 per flat in three instalments of ₹300: January to March.
      await createRule({
        name: 'Corpus fund', calculationType: 'EQUAL_PER_FLAT', effectiveFrom: '2042-01-01T00:00:00.000Z', effectiveTo: '2042-03-31T00:00:00.000Z',
        config: { amount: 300, chargeType: 'CORPUS', installments: 3, total: 900 },
      }).expect(201);

      const jan = await billsFor(2042, 1);
      expect(jan).toHaveLength(2);
      for (const bill of jan) {
        expect(bill.baseAmount.toString()).toBe('2800'); // 2500 + 300
        const types = Object.fromEntries(bill.lineItems.map((l) => [l.componentName, [l.componentType, l.amount.toString()]]));
        expect(types['Monthly maintenance']).toEqual(['MAINTENANCE', '2500']);
        expect(types['Corpus fund']).toEqual(['CORPUS', '300']);
      }
      // The same on both flats, whatever their size — "configure once".
      expect(jan[0].baseAmount.toString()).toBe(jan[1].baseAmount.toString());

      const mar = await billsFor(2042, 3);
      expect(mar[0].baseAmount.toString()).toBe('2800');

      // April: the corpus has finished, maintenance carries on.
      const apr = await billsFor(2042, 4);
      expect(apr[0].baseAmount.toString()).toBe('2500');
      expect(apr[0].lineItems.map((l) => l.componentName)).toEqual(['Monthly maintenance']);
    });

    it('an unpaid month stays owing and shows as the next month\'s arrears', async () => {
      const periods = await prisma.billingPeriod.findMany({ where: { societyId }, orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }] });
      const jan = periods.find((p) => p.periodMonth === 1)!;
      const feb = periods.find((p) => p.periodMonth === 2) ?? (await prisma.billingPeriod.findFirst({ where: { societyId, periodMonth: 3 } }))!;
      // Publish January only; February stays a draft.
      await prisma.maintenanceBill.updateMany({ where: { billingPeriodId: jan.id }, data: { isPublished: true } });
      await prisma.billingPeriod.update({ where: { id: jan.id }, data: { status: 'PUBLISHED' } });
      await prisma.maintenanceBill.updateMany({ where: { billingPeriodId: feb.id }, data: { isPublished: true } });

      const statement = (await http().get(`/api/v1/billing/periods/${feb.id}/statement`).set(auth(admin)).expect(200)).body.data.statements as { flatId: string; arrears: number; totalPayable: number; generalMaintenance: number }[];
      const a = statement.find((s) => s.flatId === flatA)!;
      expect(a.arrears).toBe(2800); // January, unpaid
      expect(a.totalPayable).toBe(a.generalMaintenance + 2800);
      void flatB;
    });
  });
});
