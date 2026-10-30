/**
 * Deleting a billing period, against a REAL Postgres, through real HTTP.
 *
 * The rule: a period can be deleted only while it holds nothing. Bills and the statement are held by
 * foreign keys; payments and water readings carry only the period's id, so the rule is the only
 * thing between them and an orphaned record — which is what these tests pin.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { SystemRole } from '@prisma/client';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const phone = (n: number) => '92' + String(UNIQUE).slice(-7) + String(n);

describe('Billing period delete (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let adminA: string;
  let societyA: string;
  let adminAUserId: string;
  let flatA: string;
  let accountantA: string;
  let residentA: string;
  let adminB: string;
  let societyB: string;

  let month = 0;
  /** A fresh period each time, so tests never meet each other's. */
  const newPeriod = async (token = adminA): Promise<string> => {
    month += 1;
    const year = 2040 + Math.floor((month - 1) / 12);
    const m = ((month - 1) % 12) + 1;
    const mm = String(m).padStart(2, '0');
    const res = await http().post('/api/v1/billing/periods').set(auth(token)).send({
      periodYear: year, periodMonth: m,
      startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-28`, dueDate: `${year}-${mm}-10`,
    }).expect(201);
    return res.body.data.id as string;
  };
  const del = (token: string, id: string) => http().delete(`/api/v1/billing/periods/${id}`).set(auth(token));
  const get = (token: string, id: string) => http().get(`/api/v1/billing/periods/${id}`).set(auth(token));
  const listed = async (token: string, id: string) => {
    const rows = (await http().get('/api/v1/billing/periods?limit=100').set(auth(token)).expect(200)).body.data as { id: string; canDelete: boolean }[];
    return rows.find((r) => r.id === id);
  };
  const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));

  async function makeUser(label: string, societyId: string, role: SystemRole, flatId: string | null = null): Promise<string> {
    const email = `${label}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: { email, firstName: label, lastName: 'Test', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId, role, status: 'ACTIVE', isPrimary: role === SystemRole.RESIDENT } });
    const login = await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200);
    return login.body.data.accessToken as string;
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

    const register = async (tag: string, ph: string) =>
      http()
        .post('/api/v1/auth/register-society')
        .send({
          society: { name: `E2E Periods ${tag} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-${tag}-${UNIQUE}@test.example`, contactPhone: ph },
          admin: { firstName: 'Admin', lastName: tag, email: `admin-${tag}-${UNIQUE}@test.example`, phone: ph, password: PASSWORD },
        })
        .expect(201);
    const a = await register('pa', phone(1));
    adminA = a.body.data.accessToken;
    societyA = a.body.data.memberships[0].societyId;
    adminAUserId = a.body.data.user.id;
    const b = await register('pb', phone(2));
    adminB = b.body.data.accessToken;
    societyB = b.body.data.memberships[0].societyId;

    const bld = await http().post('/api/v1/buildings').set(auth(adminA)).send({ name: 'PA', code: 'PA' }).expect(201);
    flatA = (await http().post('/api/v1/flats').set(auth(adminA)).send({ buildingId: bld.body.data.id, unitNumber: '101', flatCode: 'PA-101' }).expect(201)).body.data.id;
    accountantA = await makeUser('pacct', societyA, SystemRole.SOCIETY_ACCOUNTANT);
    residentA = await makeUser('pres', societyA, SystemRole.RESIDENT, flatA);
  });

  afterAll(async () => {
    if (societyA) await prisma.society.update({ where: { id: societyA }, data: { deletedAt: new Date() } });
    if (societyB) await prisma.society.update({ where: { id: societyB }, data: { deletedAt: new Date() } });
    await app.close();
  });

  describe('an empty period', () => {
    it('is offered for deletion, deletes, and is gone', async () => {
      const id = await newPeriod();
      expect((await listed(adminA, id))!.canDelete).toBe(true);
      await del(adminA, id).expect(200);
      await get(adminA, id).expect(404);
      expect(await listed(adminA, id)).toBeUndefined();
    });

    it('frees the month, so a period made by mistake can be made again', async () => {
      const id = await newPeriod();
      const p = await prisma.billingPeriod.findUniqueOrThrow({ where: { id } });
      await del(adminA, id).expect(200);
      await http().post('/api/v1/billing/periods').set(auth(adminA)).send({
        periodYear: p.periodYear, periodMonth: p.periodMonth, startDate: '2040-01-01', endDate: '2040-01-28', dueDate: '2040-01-10',
      }).expect(201);
    });

    it('lets the accountant delete it too', async () => {
      const id = await newPeriod(accountantA);
      await del(accountantA, id).expect(200);
    });

    it('is a 404 the second time', async () => {
      const id = await newPeriod();
      await del(adminA, id).expect(200);
      await del(adminA, id).expect(404);
    });

    it('writes the deletion to the audit trail', async () => {
      const id = await newPeriod();
      await del(adminA, id).expect(200);
      const rows = await prisma.auditLog.findMany({ where: { societyId: societyA, entityType: 'BillingPeriod', entityId: id } });
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows[0].oldValues)).toContain('periodMonth');
    });
  });

  describe('a period with data cannot be deleted', () => {
    const stillThere = async (id: string) => {
      await get(adminA, id).expect(200);
      expect((await listed(adminA, id))!.canDelete).toBe(false);
    };

    it('refuses when it has a bill, and says so', async () => {
      const id = await newPeriod();
      await prisma.maintenanceBill.create({
        data: { societyId: societyA, billingPeriodId: id, flatId: flatA, invoiceNumber: `INV-${UNIQUE}-1`, flatCode: 'PA-101', dueDate: new Date('2040-01-10') },
      });
      expect((await listed(adminA, id))!.canDelete).toBe(false);
      const res = await del(adminA, id).expect(409);
      expect(messageOf(res.body)).toMatch(/1 bill/);
      await stillThere(id);
      expect(await prisma.maintenanceBill.count({ where: { billingPeriodId: id } })).toBe(1);
    });

    it('refuses when it only has a payment against it — no database link holds that one', async () => {
      const id = await newPeriod();
      await prisma.paymentSubmission.create({
        data: { societyId: societyA, flatId: flatA, userId: adminAUserId, billingPeriodId: id, amount: '100', paymentDate: new Date(), paymentMethod: 'CASH' },
      });
      const res = await del(adminA, id).expect(409);
      expect(messageOf(res.body)).toMatch(/1 payment/);
      await stillThere(id);
    });

    it('refuses when it only has a water reading', async () => {
      const id = await newPeriod();
      await prisma.waterMeterReading.create({
        data: { societyId: societyA, flatId: flatA, billingPeriodId: id, readingDate: new Date(), openingReading: '1', closingReading: '2', consumption: '1' },
      });
      const res = await del(adminA, id).expect(409);
      expect(messageOf(res.body)).toMatch(/water reading/);
      await stillThere(id);
    });

    it('refuses when it has a monthly statement', async () => {
      const id = await newPeriod();
      const p = await prisma.billingPeriod.findUniqueOrThrow({ where: { id } });
      await prisma.monthlyStatement.create({
        data: { societyId: societyA, billingPeriodId: id, title: 'Statement', periodYear: p.periodYear, periodMonth: p.periodMonth },
      });
      const res = await del(adminA, id).expect(409);
      expect(messageOf(res.body)).toMatch(/statement/);
      await stillThere(id);
    });

    it('lists everything it holds', async () => {
      const id = await newPeriod();
      await prisma.maintenanceBill.create({
        data: { societyId: societyA, billingPeriodId: id, flatId: flatA, invoiceNumber: `INV-${UNIQUE}-2`, flatCode: 'PA-101', dueDate: new Date('2040-01-10') },
      });
      await prisma.waterMeterReading.create({
        data: { societyId: societyA, flatId: flatA, billingPeriodId: id, readingDate: new Date(), openingReading: '1', closingReading: '2', consumption: '1' },
      });
      const res = await del(adminA, id).expect(409);
      expect(messageOf(res.body)).toMatch(/1 bill.*1 water reading/);
    });

    it('refuses a published or closed period even when nothing is in it', async () => {
      for (const status of ['PUBLISHED', 'PAID', 'CLOSED'] as const) {
        const id = await newPeriod();
        await prisma.billingPeriod.update({ where: { id }, data: { status } });
        const res = await del(adminA, id).expect(409);
        expect(messageOf(res.body)).toMatch(/published or closed/);
        await stillThere(id);
      }
    });

    it('only counts its own data — a bill on a different period does not block this one', async () => {
      const withData = await newPeriod();
      const empty = await newPeriod();
      await prisma.maintenanceBill.create({
        data: { societyId: societyA, billingPeriodId: withData, flatId: flatA, invoiceNumber: `INV-${UNIQUE}-3`, flatCode: 'PA-101', dueDate: new Date('2040-01-10') },
      });
      await del(adminA, empty).expect(200);
      await get(adminA, withData).expect(200);
    });
  });

  describe('who can delete', () => {
    it('keeps residents out', async () => {
      const id = await newPeriod();
      await del(residentA, id).expect(403);
      await get(adminA, id).expect(200);
    });

    it('does not reach across societies', async () => {
      const id = await newPeriod();
      await del(adminB, id).expect(404);
      await get(adminA, id).expect(200);
    });
  });
});
