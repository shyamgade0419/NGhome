/**
 * Deliveries against a REAL Postgres, through real HTTP.
 *
 * What a fake cannot prove: that letting a delivery up spends the resident's instruction in ONE
 * atomic statement (so several deliveries arriving together for a flat with a single use left
 * admit exactly one), that the window is judged on the database's clock, and that two guards
 * closing the same parcel cannot both win.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 *
 * Rate limiting is neutralised for this file only (the counters, not the guard); the limits are
 * asserted by metadata in src/deliveries/deliveries.http.spec.ts.
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
const hours = (h: number) => new Date(Date.now() + h * 3_600_000);

describe('Deliveries (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  let adminA: string;
  let societyA: string;
  let flatA1: string;
  let flatA2: string;
  let resA1: string;
  let resA2: string;
  let guardA: string;
  let adminB: string;
  let societyB: string;
  let flatB1: string;
  let guardB: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let seq = 0;
  const rid = (p: string) => `${p}-${UNIQUE}-${++seq}`;
  const expect_ = (token: string, body: Record<string, unknown>) => http().post('/api/v1/delivery-expectations').set(auth(token)).send(body);
  const walkIn = (token: string, flatId: string, over: Record<string, unknown> = {}) =>
    http().post('/api/v1/gate/walk-ins').set(auth(token)).send({ flatId, visitorName: 'Delivery Boy', visitorType: 'DELIVERY', clientRequestId: rid('w'), ...over });
  const receive = (token: string, flatId: string, over: Record<string, unknown> = {}) =>
    http().post('/api/v1/gate/parcels').set(auth(token)).send({ flatId, courier: 'Amazon', clientRequestId: rid('p'), ...over });

  async function makeUser(label: string, societyId: string, role: SystemRole, flatId: string | null): Promise<string> {
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
          society: { name: `E2E Parcels ${tag} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-${tag}-${UNIQUE}@test.example`, contactPhone: ph },
          admin: { firstName: 'Admin', lastName: tag, email: `admin-${tag}-${UNIQUE}@test.example`, phone: ph, password: PASSWORD },
        })
        .expect(201);
    const a = await register('da', phone(1));
    adminA = a.body.data.accessToken;
    societyA = a.body.data.memberships[0].societyId;
    const b = await register('db', phone(2));
    adminB = b.body.data.accessToken;
    societyB = b.body.data.memberships[0].societyId;

    const bA = await http().post('/api/v1/buildings').set(auth(adminA)).send({ name: 'DA', code: 'DA' }).expect(201);
    flatA1 = (await http().post('/api/v1/flats').set(auth(adminA)).send({ buildingId: bA.body.data.id, unitNumber: '101', flatCode: 'DA-101' }).expect(201)).body.data.id;
    flatA2 = (await http().post('/api/v1/flats').set(auth(adminA)).send({ buildingId: bA.body.data.id, unitNumber: '102', flatCode: 'DA-102' }).expect(201)).body.data.id;
    const bB = await http().post('/api/v1/buildings').set(auth(adminB)).send({ name: 'DB', code: 'DB' }).expect(201);
    flatB1 = (await http().post('/api/v1/flats').set(auth(adminB)).send({ buildingId: bB.body.data.id, unitNumber: '101', flatCode: 'DB-101' }).expect(201)).body.data.id;

    resA1 = await makeUser('dresa1', societyA, SystemRole.RESIDENT, flatA1);
    resA2 = await makeUser('dresa2', societyA, SystemRole.RESIDENT, flatA2);
    guardA = await makeUser('dguarda', societyA, SystemRole.SECURITY_GUARD, null);
    guardB = await makeUser('dguardb', societyB, SystemRole.SECURITY_GUARD, null);
  });

  afterAll(async () => {
    if (societyA) await prisma.society.update({ where: { id: societyA }, data: { deletedAt: new Date() } });
    if (societyB) await prisma.society.update({ where: { id: societyB }, data: { deletedAt: new Date() } });
    await app.close();
  });

  describe('the migration, on a real database', () => {
    it('refuses an instruction that ends before it starts, and one with no uses to give', async () => {
      await expect(
        prisma.deliveryExpectation.create({ data: { societyId: societyA, flatId: flatA1, createdById: 'x', company: 'Bad', instruction: 'ALLOW_ENTRY', validFrom: hours(1), validUntil: new Date() } }),
      ).rejects.toThrow();
      await expect(
        prisma.deliveryExpectation.create({ data: { societyId: societyA, flatId: flatA1, createdById: 'x', company: 'Bad', instruction: 'ALLOW_ENTRY', validFrom: new Date(), validUntil: hours(1), maxUses: 0 } }),
      ).rejects.toThrow();
    });
  });

  describe('"let the delivery up"', () => {
    it('a resident says so, the guard sees it, and the delivery is let in without asking', async () => {
      const made = await expect_(resA1, { company: 'Amazon', instruction: 'ALLOW_ENTRY' }).expect(201);
      expect(made.body.data.flatId).toBe(flatA1);
      expect(made.body.data.state).toBe('ACTIVE');

      const seen = await http().get('/api/v1/gate/deliveries/expected').set(auth(guardA)).expect(200);
      expect(seen.body.data.some((e: any) => e.id === made.body.data.id && e.flatCode === 'DA-101')).toBe(true);

      const res = await walkIn(guardA, flatA1).expect(201);
      expect(res.body.data.entry.status).toBe('APPROVED');
      expect(res.body.data.entry.decisionMethod).toBe('EXPECTATION');
      expect(res.body.data.expectedDelivery).toBe('Amazon');

      const row = await prisma.deliveryExpectation.findUniqueOrThrow({ where: { id: made.body.data.id } });
      expect(row.usedCount).toBe(1);
    });

    it('is spent: the next delivery for that flat asks the resident as usual', async () => {
      const res = await walkIn(guardA, flatA1).expect(201);
      expect(res.body.data.entry.status).toBe('PENDING_APPROVAL');
      expect(res.body.data.expectedDelivery).toBeUndefined();
    });

    it('several deliveries at once for ONE remaining use admit exactly one', async () => {
      const made = await expect_(resA2, { company: 'Swiggy', instruction: 'ALLOW_ENTRY', maxUses: 1 }).expect(201);
      const results = await Promise.all(Array.from({ length: 8 }, () => walkIn(guardA, flatA2)));
      results.forEach((r) => expect(r.status).toBe(201));
      const statuses = results.map((r) => r.body.data.entry.status as string);
      expect(statuses.filter((s) => s === 'APPROVED')).toHaveLength(1);
      expect(statuses.filter((s) => s === 'PENDING_APPROVAL')).toHaveLength(7);
      const row = await prisma.deliveryExpectation.findUniqueOrThrow({ where: { id: made.body.data.id } });
      expect(row.usedCount).toBe(1);
    });

    it('an instruction with three uses admits three of five at once, never more', async () => {
      await prisma.deliveryExpectation.updateMany({ where: { flatId: flatA2 }, data: { status: 'CANCELLED' } });
      const made = await expect_(resA2, { company: 'Zepto', instruction: 'ALLOW_ENTRY', maxUses: 3 }).expect(201);
      const results = await Promise.all(Array.from({ length: 5 }, () => walkIn(guardA, flatA2)));
      expect(results.filter((r) => r.body.data.entry.status === 'APPROVED')).toHaveLength(3);
      const row = await prisma.deliveryExpectation.findUniqueOrThrow({ where: { id: made.body.data.id } });
      expect(row.usedCount).toBe(3);
    });

    it('is not honoured once cancelled', async () => {
      await prisma.deliveryExpectation.updateMany({ where: { flatId: flatA1 }, data: { status: 'CANCELLED' } });
      const made = await expect_(resA1, { company: 'Flipkart', instruction: 'ALLOW_ENTRY' }).expect(201);
      await http().post(`/api/v1/delivery-expectations/${made.body.data.id}/cancel`).set(auth(resA1)).expect(200);
      const res = await walkIn(guardA, flatA1).expect(201);
      expect(res.body.data.entry.status).toBe('PENDING_APPROVAL');
    });

    it('is not honoured after it has expired (judged on the database clock)', async () => {
      await prisma.deliveryExpectation.updateMany({ where: { flatId: flatA1 }, data: { status: 'CANCELLED' } });
      await prisma.deliveryExpectation.create({
        data: { societyId: societyA, flatId: flatA1, createdById: 'x', company: 'Old', instruction: 'ALLOW_ENTRY', validFrom: hours(-3), validUntil: hours(-1) },
      });
      const res = await walkIn(guardA, flatA1).expect(201);
      expect(res.body.data.entry.status).toBe('PENDING_APPROVAL');
    });

    it('"leave it at the gate" never lets anyone up', async () => {
      await prisma.deliveryExpectation.updateMany({ where: { flatId: flatA1 }, data: { status: 'CANCELLED' } });
      await expect_(resA1, { company: 'Myntra', instruction: 'LEAVE_AT_GATE', note: 'Dog at home' }).expect(201);
      const res = await walkIn(guardA, flatA1).expect(201);
      expect(res.body.data.entry.status).toBe('PENDING_APPROVAL');
    });

    it("another flat's instruction does not admit a delivery for this flat", async () => {
      await prisma.deliveryExpectation.updateMany({ where: { flatId: { in: [flatA1, flatA2] } }, data: { status: 'CANCELLED' } });
      await expect_(resA2, { company: 'Amazon', instruction: 'ALLOW_ENTRY', maxUses: 5 }).expect(201);
      const res = await walkIn(guardA, flatA1).expect(201);
      expect(res.body.data.entry.status).toBe('PENDING_APPROVAL');
    });

    it('only a DELIVERY visit uses it: a guest for that flat still asks', async () => {
      const res = await walkIn(guardA, flatA2, { visitorType: 'GUEST', visitorName: 'Cousin' }).expect(201);
      expect(res.body.data.entry.status).toBe('PENDING_APPROVAL');
    });

    it('a retried submission does not spend a second use', async () => {
      await prisma.deliveryExpectation.updateMany({ where: { flatId: flatA2 }, data: { status: 'CANCELLED' } });
      const made = await expect_(resA2, { company: 'Amazon', instruction: 'ALLOW_ENTRY', maxUses: 2 }).expect(201);
      const id = rid('retry');
      const first = await walkIn(guardA, flatA2, { clientRequestId: id }).expect(201);
      const again = await walkIn(guardA, flatA2, { clientRequestId: id }).expect(201);
      expect(again.body.data.duplicate).toBe(true);
      expect(again.body.data.entry.id).toBe(first.body.data.entry.id);
      const row = await prisma.deliveryExpectation.findUniqueOrThrow({ where: { id: made.body.data.id } });
      expect(row.usedCount).toBe(1);
    });
  });

  describe('who may do what', () => {
    it('a guard cannot give delivery instructions, and a resident cannot work the gate', async () => {
      await expect_(guardA, { company: 'Amazon', instruction: 'ALLOW_ENTRY' }).expect(403);
      await http().get('/api/v1/parcels/my').set(auth(guardA)).expect(403);
      await receive(resA1, flatA1).expect(403);
      await http().get('/api/v1/gate/deliveries/expected').set(auth(resA1)).expect(403);
    });

    it("a resident cannot cancel another flat's instruction, and the answer is the same as for a missing one", async () => {
      const made = await expect_(resA1, { company: 'Nykaa', instruction: 'LEAVE_AT_GATE' }).expect(201);
      await http().post(`/api/v1/delivery-expectations/${made.body.data.id}/cancel`).set(auth(resA2)).expect(404);
      await http().post('/api/v1/delivery-expectations/does-not-exist/cancel').set(auth(resA2)).expect(404);
    });

    it('the instruction cannot carry a flat of its own choosing', async () => {
      await expect_(resA1, { company: 'Amazon', instruction: 'ALLOW_ENTRY', flatId: flatA2 }).expect(400);
    });
  });

  describe('parcels', () => {
    it('the guard records one, the household is told and sees it, other flats and societies do not', async () => {
      const res = await receive(guardA, flatA1, { recipientName: 'Asha', note: 'Large box' }).expect(201);
      expect(res.body.data.parcel.status).toBe('RECEIVED');
      expect(res.body.data.parcel.flatCode).toBe('DA-101');
      expect(res.body.data.notifiedResidents).toBeGreaterThanOrEqual(1);
      const id = res.body.data.parcel.id;

      const mine = await http().get('/api/v1/parcels/my').set(auth(resA1)).expect(200);
      expect(mine.body.data.map((p: any) => p.id)).toContain(id);
      const theirs = await http().get('/api/v1/parcels/my').set(auth(resA2)).expect(200);
      expect(theirs.body.data.map((p: any) => p.id)).not.toContain(id);

      await http().post(`/api/v1/gate/parcels/${id}/hand-over`).set(auth(guardB)).send({}).expect(404);
      await receive(guardB, flatA1).expect(404);
      const other = await http().get('/api/v1/gate/parcels').set(auth(guardB)).expect(200);
      expect(other.body.data.map((p: any) => p.id)).not.toContain(id);
    });

    it('a retried submission returns the same parcel', async () => {
      const id = rid('retry-parcel');
      const first = await receive(guardA, flatA2, { clientRequestId: id }).expect(201);
      const again = await receive(guardA, flatA2, { clientRequestId: id }).expect(201);
      expect(again.body.data.duplicate).toBe(true);
      expect(again.body.data.parcel.id).toBe(first.body.data.parcel.id);
      expect(await prisma.parcel.count({ where: { societyId: societyA, clientRequestId: id } })).toBe(1);
    });

    it('hand-over and return racing each other: one wins, the other is told it is closed', async () => {
      const made = await receive(guardA, flatA1).expect(201);
      const id = made.body.data.parcel.id;
      const [a, b] = await Promise.all([
        http().post(`/api/v1/gate/parcels/${id}/hand-over`).set(auth(guardA)).send({ collectedByName: 'Asha' }),
        http().post(`/api/v1/gate/parcels/${id}/return`).set(auth(guardA)).send({}),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const row = await prisma.parcel.findUniqueOrThrow({ where: { id } });
      expect(['COLLECTED', 'RETURNED']).toContain(row.status);
      expect(row.closedAt).not.toBeNull();
    });

    it('handing over twice is harmless', async () => {
      const made = await receive(guardA, flatA1).expect(201);
      const id = made.body.data.parcel.id;
      await http().post(`/api/v1/gate/parcels/${id}/hand-over`).set(auth(guardA)).send({ collectedByName: 'Asha' }).expect(200);
      const again = await http().post(`/api/v1/gate/parcels/${id}/hand-over`).set(auth(guardA)).send({}).expect(200);
      expect(again.body.data.status).toBe('COLLECTED');
      expect(again.body.data.collectedByName).toBe('Asha');
    });

    it('the committee reads the log, filtered, with the names of who acted; residents and guards may not', async () => {
      const log = await http().get('/api/v1/parcels?status=COLLECTED&search=DA-101').set(auth(adminA)).expect(200);
      expect(log.body.data.length).toBeGreaterThanOrEqual(1);
      expect(log.body.data.every((p: any) => p.status === 'COLLECTED' && p.flatCode === 'DA-101')).toBe(true);
      expect(log.body.data[0].receivedBy).toMatch(/dguarda/);
      await http().get('/api/v1/parcels').set(auth(resA1)).expect(403);
      await http().get('/api/v1/parcels').set(auth(guardA)).expect(403);
      const none = await http().get('/api/v1/parcels').set(auth(adminB)).expect(200);
      expect(none.body.data).toHaveLength(0);
      expect(flatB1).toBeDefined();
    });

    it('the audit trail records the receipt and the hand-over', async () => {
      const rows = await prisma.auditLog.findMany({ where: { societyId: societyA, entityType: 'Parcel' } });
      const actions = rows.map((r) => (r.newValues as any)?.action);
      expect(actions).toContain('PARCEL_RECEIVED');
      expect(actions).toContain('PARCEL_HANDED_OVER');
    });
  });
});
