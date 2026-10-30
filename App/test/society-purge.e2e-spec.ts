/**
 * Permanent society delete, on a REAL Postgres.
 *
 * The first production purges failed with "Foreign key constraint failed"
 * because the order of deletes was derived from Prisma's schema while the live
 * database enforces different rules (optional keys created with no ON DELETE
 * clause block the parent). The unit tests now read the migration SQL, but
 * only a real database can say whether the order actually works. So this
 * seeds a society with the very relationships that failed — line items that
 * point at billing rules, transactions at accounts and funds, expenses at
 * categories and accounts — purges it, and checks what is left.
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
const phone = (n: number) => '93' + String(UNIQUE).slice(-7) + String(n);

describe('Permanent society delete (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let platformToken: string;
  let victimAdmin: string;
  let victimId: string;
  let victimName: string;
  let bystanderId: string;
  let exclusiveUserId: string;
  let sharedUserId: string;
  let bystanderFlatId: string;

  async function login(email: string): Promise<string> {
    const res = await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200);
    return res.body.data.accessToken as string;
  }

  async function user(label: string, extra: Record<string, unknown> = {}) {
    return prisma.user.create({
      data: { email: `${label}-${UNIQUE}@test.example`, firstName: label, lastName: 'Purge', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true, ...extra },
    });
  }

  /** Rows in every kind of table the purge has to get through — each wired the way production data is. */
  async function seedRichData(societyId: string, flatId: string, authorId: string) {
    const now = new Date();
    const later = new Date(Date.now() + 86_400_000);

    const account = await prisma.account.create({ data: { societyId, name: 'Main account', accountType: 'SAVINGS' } });
    const fund = await prisma.fund.create({ data: { societyId, name: 'Sinking fund', accountId: account.id } });
    await prisma.transaction.create({
      data: { societyId, accountId: account.id, fundId: fund.id, transactionType: 'CREDIT', amount: '1000', transactionDate: now, description: 'Opening', balanceAfter: '1000' },
    });
    const category = await prisma.expenseCategory.create({ data: { societyId, name: 'Repairs' } });
    await prisma.expense.create({
      data: { societyId, categoryId: category.id, accountId: account.id, description: 'Lift', amount: '500', expenseDate: now, createdById: authorId, approvedById: authorId },
    });

    const rule = await prisma.billingRule.create({ data: { societyId, name: 'Flat rate', calculationType: 'EQUAL_PER_FLAT', effectiveFrom: now } });
    const period = await prisma.billingPeriod.create({ data: { societyId, periodYear: 2026, periodMonth: 10, startDate: now, endDate: later, dueDate: later } });
    const bill = await prisma.maintenanceBill.create({
      data: { societyId, billingPeriodId: period.id, flatId, invoiceNumber: `INV-${UNIQUE}-${societyId.slice(0, 4)}`, flatCode: 'X-1', dueDate: later },
    });
    await prisma.billLineItem.create({ data: { maintenanceBillId: bill.id, billingRuleId: rule.id, componentName: 'Maintenance', componentType: 'FIXED', amount: '2500' } });
    await prisma.monthlyStatement.create({ data: { societyId, billingPeriodId: period.id, periodYear: 2026, periodMonth: 10 } as never }).catch(() => undefined);

    const water = await prisma.waterBillingConfig.create({ data: { societyId, name: 'Water', billingModel: 'PER_KL', effectiveFrom: now } });
    await prisma.waterMeterReading.create({
      data: { societyId, flatId, waterConfigId: water.id, readingDate: now, openingReading: '10', closingReading: '20', consumption: '10' },
    });

    await prisma.visitorEntry.create({ data: { societyId, flatId, visitorName: 'Visitor', clientRequestId: `purge-${societyId}` } });
    await prisma.visitorInvitation.create({
      data: { societyId, flatId, createdById: authorId, visitorName: 'Guest', validFrom: now, validUntil: later, codeHash: `purge-hash-${societyId}` },
    });
    await prisma.amenity.create({ data: { societyId, name: 'Clubhouse' } });

    await prisma.deliveryExpectation.create({ data: { societyId, flatId, createdById: authorId, company: 'Amazon', instruction: 'ALLOW_ENTRY', validFrom: now, validUntil: later } });
    await prisma.parcel.create({ data: { societyId, flatId, courier: 'Amazon', clientRequestId: `purge-parcel-${societyId}` } });
    const helper = await prisma.domesticHelper.create({ data: { societyId, name: 'Helper', role: 'MAID', codeHash: `purge-helper-${societyId}`, createdById: authorId } });
    await prisma.domesticHelperFlat.create({ data: { societyId, helperId: helper.id, flatId, addedById: authorId } });
    await prisma.domesticHelperVisit.create({ data: { societyId, helperId: helper.id, method: 'GUARD' } });

    const vehicle = await prisma.vehicle.create({ data: { societyId, flatId, plate: `PG${societyId.slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, '0')}01`, kind: 'CAR', createdById: authorId } });
    await prisma.parkingSlot.create({ data: { societyId, code: 'P-1', flatId, vehicleId: vehicle.id, allocatedAt: now } });

    const employee = await prisma.societyEmployee.create({ data: { societyId, name: 'Guard Staff', designation: 'Security', baseSalary: '15000' } });
    const shift = await prisma.staffShift.create({ data: { societyId, name: 'Morning', startMinute: 360, endMinute: 840 } });
    const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    await prisma.staffRoster.create({ data: { societyId, employeeId: employee.id, date: day, shiftId: shift.id, assignedById: authorId } });
    await prisma.staffAttendance.create({ data: { societyId, employeeId: employee.id, date: day, checkInAt: now } });
  }

  const TABLES_WITH_SOCIETY = ['account', 'fund', 'transaction', 'expenseCategory', 'expense', 'billingRule', 'billingPeriod', 'maintenanceBill', 'waterBillingConfig', 'waterMeterReading', 'visitorEntry', 'visitorInvitation', 'amenity', 'deliveryExpectation', 'parcel', 'domesticHelper', 'domesticHelperFlat', 'domesticHelperVisit', 'vehicle', 'parkingSlot', 'societyEmployee', 'staffShift', 'staffRoster', 'staffAttendance', 'flat', 'building', 'announcement'] as const;
  const countFor = async (societyId: string) => {
    const out: Record<string, number> = {};
    for (const t of TABLES_WITH_SOCIETY) out[t] = await (prisma as any)[t].count({ where: { societyId } });
    return out;
  };

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

    const register = (tag: string, n: number) =>
      http()
        .post('/api/v1/auth/register-society')
        .send({
          society: { name: `E2E Purge ${tag} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `purge-${tag}-${UNIQUE}@test.example`, contactPhone: phone(n) },
          admin: { firstName: 'Admin', lastName: tag, email: `purge-admin-${tag}-${UNIQUE}@test.example`, phone: phone(n), password: PASSWORD },
        })
        .expect(201);

    const v = await register('victim', 1);
    victimAdmin = v.body.data.accessToken;
    victimId = v.body.data.memberships[0].societyId;
    victimName = `E2E Purge victim ${UNIQUE}`;
    const b = await register('bystander', 2);
    const bystanderAdmin = b.body.data.accessToken as string;
    bystanderId = b.body.data.memberships[0].societyId;

    // Real, API-made structure in both societies.
    const mk = async (token: string, code: string) => {
      const bld = await http().post('/api/v1/buildings').set(auth(token)).send({ name: code, code }).expect(201);
      const flat = await http().post('/api/v1/flats').set(auth(token)).send({ buildingId: bld.body.data.id, unitNumber: '1', flatCode: `${code}-1` }).expect(201);
      await http().post('/api/v1/announcements').set(auth(token)).send({ title: `Notice ${code}`, content: 'Hello', audience: 'ALL' }).expect(201);
      return flat.body.data.id as string;
    };
    const victimFlat = await mk(victimAdmin, 'PV');
    bystanderFlatId = await mk(bystanderAdmin, 'PB');

    // People: one who exists only in the victim society, one who also belongs to the bystander.
    const victimAdminUser = await prisma.user.findFirstOrThrow({ where: { email: `purge-admin-victim-${UNIQUE}@test.example` } });
    const exclusive = await user('exclusive');
    exclusiveUserId = exclusive.id;
    await prisma.societyMembership.create({ data: { societyId: victimId, userId: exclusive.id, flatId: victimFlat, role: SystemRole.RESIDENT, status: 'ACTIVE' } });
    const shared = await user('shared');
    sharedUserId = shared.id;
    await prisma.societyMembership.create({ data: { societyId: victimId, userId: shared.id, flatId: victimFlat, role: SystemRole.RESIDENT, status: 'ACTIVE' } });
    await prisma.societyMembership.create({ data: { societyId: bystanderId, userId: shared.id, flatId: bystanderFlatId, role: SystemRole.RESIDENT, status: 'ACTIVE' } });

    await seedRichData(victimId, victimFlat, victimAdminUser.id);
    const bystanderAdminUser = await prisma.user.findFirstOrThrow({ where: { email: `purge-admin-bystander-${UNIQUE}@test.example` } });
    await seedRichData(bystanderId, bystanderFlatId, bystanderAdminUser.id);

    const platform = await user('platform', { isPlatformAdmin: true });
    platformToken = await login(platform.email);
  });

  afterAll(async () => {
    if (bystanderId) await prisma.society.update({ where: { id: bystanderId }, data: { deletedAt: new Date() } }).catch(() => undefined);
    await app.close();
  });

  it('is refused to a society admin, and does nothing', async () => {
    await http().post(`/api/v1/societies/${victimId}/purge`).set(auth(victimAdmin)).send({ confirmName: victimName }).expect(403);
    expect(await prisma.society.count({ where: { id: victimId } })).toBe(1);
  });

  it('refuses a wrong confirmation name, and deletes nothing', async () => {
    const before = await countFor(victimId);
    const res = await http().post(`/api/v1/societies/${victimId}/purge`).set(auth(platformToken)).send({ confirmName: 'Some Other Society' }).expect(400);
    expect(res.body.message).toMatch(/does not match/);
    expect(await countFor(victimId)).toEqual(before);
  });

  it('starts from a society that really is full of linked data', async () => {
    const counts = await countFor(victimId);
    for (const t of TABLES_WITH_SOCIETY) expect({ t, n: counts[t] }).toEqual({ t, n: expect.any(Number) });
    expect(counts.billingRule).toBe(1);
    expect(counts.transaction).toBe(1);
    expect(counts.expense).toBe(1);
    expect(await prisma.billLineItem.count({ where: { maintenanceBill: { societyId: victimId } } })).toBe(1);
  });

  describe('the purge itself', () => {
    let body: any;

    beforeAll(async () => {
      const res = await http().post(`/api/v1/societies/${victimId}/purge`).set(auth(platformToken)).send({ confirmName: victimName });
      body = res;
    });

    it('succeeds on a society with data — no foreign-key error', () => {
      expect(body.body.message ?? '').not.toMatch(/foreign key/i);
      expect(body.status).toBe(200);
      expect(body.body.data).toMatchObject({ id: victimId, name: victimName });
    });

    it('removes the society and every row it owned', async () => {
      expect(await prisma.society.count({ where: { id: victimId } })).toBe(0);
      const counts = await countFor(victimId);
      for (const t of TABLES_WITH_SOCIETY) expect({ t, n: counts[t] }).toEqual({ t, n: 0 });
      expect(await prisma.billLineItem.count({ where: { maintenanceBill: { societyId: victimId } } })).toBe(0);
      expect(await prisma.societyMembership.count({ where: { societyId: victimId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { societyId: victimId } })).toBe(0);
    });

    it('removes people who belonged only to that society, and frees their email', async () => {
      expect(await prisma.user.count({ where: { id: exclusiveUserId } })).toBe(0);
      expect(await prisma.user.count({ where: { email: `purge-admin-victim-${UNIQUE}@test.example` } })).toBe(0);
    });

    it('keeps a person who also belongs to another society, with that membership intact', async () => {
      expect(await prisma.user.count({ where: { id: sharedUserId } })).toBe(1);
      const left = await prisma.societyMembership.findMany({ where: { userId: sharedUserId } });
      expect(left.map((m) => m.societyId)).toEqual([bystanderId]);
    });

    it('leaves the other society exactly as it was', async () => {
      const counts = await countFor(bystanderId);
      expect(counts).toMatchObject({ account: 1, fund: 1, transaction: 1, expense: 1, billingRule: 1, maintenanceBill: 1, visitorEntry: 1, visitorInvitation: 1, amenity: 1, deliveryExpectation: 1, parcel: 1, domesticHelper: 1, domesticHelperFlat: 1, domesticHelperVisit: 1, vehicle: 1, parkingSlot: 1, societyEmployee: 1, staffShift: 1, staffRoster: 1, staffAttendance: 1, flat: 1, building: 1, announcement: 1 });
      expect(await prisma.billLineItem.count({ where: { maintenanceBill: { societyId: bystanderId } } })).toBe(1);
    });

    it('keeps one record of who erased what, with no society attached', async () => {
      const audit = await prisma.auditLog.findFirst({ where: { entityId: victimId, societyId: null } });
      expect(audit).toBeTruthy();
      expect(audit?.newValues).toMatchObject({ action: 'SOCIETY_PURGED' });
    });

    it('is not repeatable: a second purge finds nothing', async () => {
      await http().post(`/api/v1/societies/${victimId}/purge`).set(auth(platformToken)).send({ confirmName: victimName }).expect(404);
    });
  });
});
