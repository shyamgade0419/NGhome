/**
 * Domestic help against a REAL Postgres, through real HTTP.
 *
 * What a fake cannot prove: that a helper can be inside only once (the database allows one open
 * visit each, so simultaneous check-ins create exactly one), that one person working for two flats
 * is one record found by phone however it is typed, and that societies stay apart.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 *
 * Rate limiting is neutralised for this file only (the counters, not the guard); the limits are
 * asserted by metadata in src/helpers/helpers.http.spec.ts.
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
/** A helper's phone, distinct per run so reruns on one database do not collide. */
const helperPhone = (n: number) => '98' + String(UNIQUE).slice(-7) + String(n);

describe('Domestic help (e2e, real Postgres)', () => {
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
  let resB1: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let seq = 0;
  const rid = (p: string) => `${p}-${UNIQUE}-${++seq}`;
  const add = (token: string, body: Record<string, unknown>) => http().post('/api/v1/domestic-helpers').set(auth(token)).send(body);
  const checkInById = (token: string, id: string, clientRequestId = rid('c')) =>
    http().post(`/api/v1/gate/helpers/${id}/check-in`).set(auth(token)).send({ clientRequestId });
  const scan = (token: string, code: string, clientRequestId = rid('s')) => http().post('/api/v1/gate/helpers/scan').set(auth(token)).send({ code, clientRequestId });
  const checkOut = (token: string, visitId: string) => http().post(`/api/v1/gate/helper-visits/${visitId}/check-out`).set(auth(token)).send({});

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
          society: { name: `E2E Help ${tag} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-${tag}-${UNIQUE}@test.example`, contactPhone: ph },
          admin: { firstName: 'Admin', lastName: tag, email: `admin-${tag}-${UNIQUE}@test.example`, phone: ph, password: PASSWORD },
        })
        .expect(201);
    const a = await register('ha', phone(1));
    adminA = a.body.data.accessToken;
    societyA = a.body.data.memberships[0].societyId;
    const b = await register('hb', phone(2));
    adminB = b.body.data.accessToken;
    societyB = b.body.data.memberships[0].societyId;

    const bA = await http().post('/api/v1/buildings').set(auth(adminA)).send({ name: 'HA', code: 'HA' }).expect(201);
    flatA1 = (await http().post('/api/v1/flats').set(auth(adminA)).send({ buildingId: bA.body.data.id, unitNumber: '101', flatCode: 'HA-101' }).expect(201)).body.data.id;
    flatA2 = (await http().post('/api/v1/flats').set(auth(adminA)).send({ buildingId: bA.body.data.id, unitNumber: '102', flatCode: 'HA-102' }).expect(201)).body.data.id;
    const bB = await http().post('/api/v1/buildings').set(auth(adminB)).send({ name: 'HB', code: 'HB' }).expect(201);
    flatB1 = (await http().post('/api/v1/flats').set(auth(adminB)).send({ buildingId: bB.body.data.id, unitNumber: '101', flatCode: 'HB-101' }).expect(201)).body.data.id;

    resA1 = await makeUser('hresa1', societyA, SystemRole.RESIDENT, flatA1);
    resA2 = await makeUser('hresa2', societyA, SystemRole.RESIDENT, flatA2);
    guardA = await makeUser('hguarda', societyA, SystemRole.SECURITY_GUARD, null);
    guardB = await makeUser('hguardb', societyB, SystemRole.SECURITY_GUARD, null);
    resB1 = await makeUser('hresb1', societyB, SystemRole.RESIDENT, flatB1);
  });

  afterAll(async () => {
    if (societyA) await prisma.society.update({ where: { id: societyA }, data: { deletedAt: new Date() } });
    if (societyB) await prisma.society.update({ where: { id: societyB }, data: { deletedAt: new Date() } });
    await app.close();
  });

  // Shared across the ordered tests below.
  let lakshmiId: string;
  let lakshmiCode: string;
  let firstCode: string;
  const LAKSHMI = helperPhone(1);

  describe('the migration, on a real database', () => {
    it('allows only one open visit per helper (partial unique index)', async () => {
      const code = `idx-${UNIQUE}`;
      const h = await prisma.domesticHelper.create({ data: { societyId: societyA, name: 'Index Test', role: 'MAID', codeHash: code, createdById: 'x' } });
      await prisma.domesticHelperVisit.create({ data: { societyId: societyA, helperId: h.id, method: 'GUARD' } });
      await expect(prisma.domesticHelperVisit.create({ data: { societyId: societyA, helperId: h.id, method: 'GUARD' } })).rejects.toThrow();
      // A closed visit does not count, so the same person can come again.
      await prisma.domesticHelperVisit.updateMany({ where: { helperId: h.id }, data: { checkedOutAt: new Date(Date.now() + 1000) } });
      await expect(prisma.domesticHelperVisit.create({ data: { societyId: societyA, helperId: h.id, method: 'GUARD' } })).resolves.toBeDefined();
    });

    it('refuses an exit before the entry (CHECK constraint)', async () => {
      const h = await prisma.domesticHelper.create({ data: { societyId: societyA, name: 'Check Test', role: 'MAID', codeHash: `chk-${UNIQUE}`, createdById: 'x' } });
      await expect(
        prisma.domesticHelperVisit.create({ data: { societyId: societyA, helperId: h.id, method: 'GUARD', checkedInAt: new Date(), checkedOutAt: new Date(Date.now() - 3_600_000) } }),
      ).rejects.toThrow();
    });
  });

  describe('adding someone to my household', () => {
    it('makes a new person with a one-time code, on the resident’s own flat', async () => {
      const res = await add(resA1, { name: 'Lakshmi', role: 'MAID', phone: `+91 ${LAKSHMI.slice(0, 5)} ${LAKSHMI.slice(5)}` }).expect(201);
      expect(res.body.data.linked).toBe(false);
      expect(res.body.data.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(res.body.data.helper).not.toHaveProperty('codeHash');
      expect(res.body.data.helper.phone).toBe(LAKSHMI);
      lakshmiId = res.body.data.helper.id;
      lakshmiCode = res.body.data.code;
      firstCode = lakshmiCode;

      const mine = await http().get('/api/v1/domestic-helpers/my').set(auth(resA1)).expect(200);
      expect(mine.body.data.map((h: any) => h.id)).toContain(lakshmiId);
      const other = await http().get('/api/v1/domestic-helpers/my').set(auth(resA2)).expect(200);
      expect(other.body.data.map((h: any) => h.id)).not.toContain(lakshmiId);
    });

    it('never stores the code, only its hash', async () => {
      const row = await prisma.domesticHelper.findUniqueOrThrow({ where: { id: lakshmiId } });
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(lakshmiCode.replace('-', ''));
    });

    it('the same person for a second flat, typed differently, is linked and gets no new code', async () => {
      const res = await add(resA2, { name: 'Lakshmi K', role: 'MAID', phone: `0${LAKSHMI}` }).expect(201);
      expect(res.body.data.linked).toBe(true);
      expect(res.body.data.code).toBeUndefined();
      expect(res.body.data.helper.id).toBe(lakshmiId);
      expect(await prisma.domesticHelper.count({ where: { societyId: societyA, phone: LAKSHMI } })).toBe(1);
      expect(await prisma.domesticHelperFlat.count({ where: { helperId: lakshmiId, active: true } })).toBe(2);
    });

    it('adding someone already on the list is refused', async () => {
      await add(resA1, { name: 'Lakshmi', role: 'MAID', phone: LAKSHMI }).expect(409);
    });

    it('two adds of the same new number at once make one person', async () => {
      const ph = helperPhone(2);
      const [a, b] = await Promise.all([add(resA1, { name: 'Race Helper', role: 'COOK', phone: ph }), add(resA2, { name: 'Race Helper', role: 'COOK', phone: ph })]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(await prisma.domesticHelper.count({ where: { societyId: societyA, phone: ph } })).toBe(1);
      expect([a.body.data.linked, b.body.data.linked].sort()).toEqual([false, true]);
    });

    it('another society with the same phone gets its own person and its own code', async () => {
      const res = await add(resB1, { name: 'Lakshmi', role: 'MAID', phone: LAKSHMI }).expect(201);
      expect(res.body.data.linked).toBe(false);
      expect(res.body.data.helper.id).not.toBe(lakshmiId);
      expect(res.body.data.code).not.toBe(lakshmiCode);
    });

    it('a person without a phone can be added, and two of them are two people', async () => {
      const a = await add(resA1, { name: 'No Phone One', role: 'GARDENER' }).expect(201);
      const b = await add(resA1, { name: 'No Phone Two', role: 'GARDENER' }).expect(201);
      expect(a.body.data.helper.id).not.toBe(b.body.data.helper.id);
    });

    it('the flat cannot be chosen by the request, and gate staff cannot act as a household', async () => {
      await add(resA1, { name: 'Sneaky', role: 'MAID', flatId: flatA2 }).expect(400);
      await add(guardA, { name: 'Guard Adds', role: 'MAID' }).expect(403);
      await http().get('/api/v1/domestic-helpers/my').set(auth(guardA)).expect(403);
    });
  });

  describe('at the gate', () => {
    let visitId: string;

    it('the guard sees names and flat numbers, not phone numbers', async () => {
      const res = await http().get('/api/v1/gate/helpers?search=lakshmi').set(auth(guardA)).expect(200);
      const l = res.body.data.find((h: any) => h.id === lakshmiId);
      expect(l.flatCodes).toEqual(['HA-101', 'HA-102']);
      expect(l.inside).toBe(false);
      expect(l).not.toHaveProperty('phone');
      expect(l).not.toHaveProperty('codeHash');
      const byFlat = await http().get('/api/v1/gate/helpers?search=HA-102').set(auth(guardA)).expect(200);
      expect(byFlat.body.data.map((h: any) => h.id)).toContain(lakshmiId);
    });

    it('lets her in with her pass code', async () => {
      const res = await scan(guardA, lakshmiCode.toLowerCase().replace('-', ' ')).expect(200);
      expect(res.body.data.alreadyInside).toBe(false);
      expect(res.body.data.visit.method).toBe('CODE');
      expect(res.body.data.helper).toEqual({ id: lakshmiId, name: 'Lakshmi', role: 'MAID', flatCodes: ['HA-101', 'HA-102'] });
      expect(res.body.data.visit.checkedOutAt).toBeNull();
      expect(res.body.data.visit).not.toHaveProperty('clientRequestId');
      visitId = res.body.data.visit.id;
    });

    it('a retried check-in returns the same visit', async () => {
      const id = rid('retry');
      await checkOut(guardA, visitId).expect(200);
      const first = await checkInById(guardA, lakshmiId, id).expect(200);
      const again = await checkInById(guardA, lakshmiId, id).expect(200);
      expect(again.body.data.duplicate).toBe(true);
      expect(again.body.data.visit.id).toBe(first.body.data.visit.id);
      visitId = first.body.data.visit.id;
    });

    it('scanning someone already inside does not make a second visit', async () => {
      const res = await scan(guardA, lakshmiCode).expect(200);
      expect(res.body.data.alreadyInside).toBe(true);
      expect(res.body.data.visit.id).toBe(visitId);
      expect(await prisma.domesticHelperVisit.count({ where: { helperId: lakshmiId, checkedOutAt: null } })).toBe(1);
    });

    it('many guards letting her in at once make exactly one visit', async () => {
      await checkOut(guardA, visitId).expect(200);
      const before = await prisma.domesticHelperVisit.count({ where: { helperId: lakshmiId } });
      const results = await Promise.all(Array.from({ length: 8 }, () => checkInById(guardA, lakshmiId)));
      results.forEach((r) => expect(r.status).toBe(200));
      expect(results.filter((r) => r.body.data.alreadyInside === false)).toHaveLength(1);
      expect(results.filter((r) => r.body.data.alreadyInside === true)).toHaveLength(7);
      expect(await prisma.domesticHelperVisit.count({ where: { helperId: lakshmiId } })).toBe(before + 1);
      expect(await prisma.domesticHelperVisit.count({ where: { helperId: lakshmiId, checkedOutAt: null } })).toBe(1);
      visitId = (await prisma.domesticHelperVisit.findFirstOrThrow({ where: { helperId: lakshmiId, checkedOutAt: null } })).id;
    });

    it('shows her inside now on the gate list and to both households', async () => {
      const gate = await http().get('/api/v1/gate/helper-visits').set(auth(guardA)).expect(200);
      const v = gate.body.data.find((x: any) => x.id === visitId);
      expect(v).toMatchObject({ name: 'Lakshmi', role: 'MAID', flatCodes: ['HA-101', 'HA-102'] });
      const mine = await http().get('/api/v1/domestic-helpers/my').set(auth(resA2)).expect(200);
      expect(mine.body.data.find((h: any) => h.id === lakshmiId).inside).toBe(true);
    });

    it('two guards recording the exit together close it once', async () => {
      const [a, b] = await Promise.all([checkOut(guardA, visitId), checkOut(guardA, visitId)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const row = await prisma.domesticHelperVisit.findUniqueOrThrow({ where: { id: visitId } });
      expect(row.checkedOutAt).not.toBeNull();
      expect(row.checkedOutById).not.toBeNull();
      const logged = await prisma.auditLog.count({ where: { societyId: societyA, entityId: visitId, entityType: 'DomesticHelperVisit' } });
      expect(logged).toBe(2); // one check-in, one check-out
    });

    it('a visit left open from an earlier day is closed and flagged, then she comes in normally', async () => {
      const h = await prisma.domesticHelper.create({ data: { societyId: societyA, name: 'Forgot Exit', role: 'MAID', codeHash: `stale-${UNIQUE}`, createdById: 'x' } });
      await prisma.domesticHelperFlat.create({ data: { societyId: societyA, helperId: h.id, flatId: flatA1, addedById: 'x' } });
      const old = await prisma.domesticHelperVisit.create({ data: { societyId: societyA, helperId: h.id, method: 'GUARD', checkedInAt: new Date(Date.now() - 2 * 86_400_000) } });

      const res = await checkInById(guardA, h.id).expect(200);
      expect(res.body.data.alreadyInside).toBe(false);
      const closed = await prisma.domesticHelperVisit.findUniqueOrThrow({ where: { id: old.id } });
      expect(closed.autoClosed).toBe(true);
      expect(closed.checkedOutAt!.getTime()).toBe(closed.checkedInAt.getTime()); // no exit time is invented
      expect(await prisma.domesticHelperVisit.count({ where: { helperId: h.id, checkedOutAt: null } })).toBe(1);
    });

    it('refuses a bad code, a code from another society, and someone from another society by id', async () => {
      await scan(guardA, 'ZZZZ-ZZZZ').expect(400);
      await scan(guardA, 'abc').expect(400);
      await scan(guardB, lakshmiCode).expect(400);
      await checkInById(guardB, lakshmiId).expect(404);
    });

    it('a visitor invitation code does not open the helper gate', async () => {
      const inv = await http().post('/api/v1/visitor-invitations').set(auth(resA1)).send({ visitorName: 'Ravi', validUntil: new Date(Date.now() + 3_600_000).toISOString() }).expect(201);
      await scan(guardA, inv.body.data.code).expect(400);
    });

    it('residents cannot work the gate', async () => {
      await checkInById(resA1, lakshmiId).expect(403);
      await scan(resA1, lakshmiCode).expect(403);
      await http().get('/api/v1/gate/helpers').set(auth(resA1)).expect(403);
      await checkOut(resA1, visitId).expect(403);
    });

    it('another society cannot close our visit', async () => {
      const h = await prisma.domesticHelper.findUniqueOrThrow({ where: { id: lakshmiId } });
      const open = await checkInById(guardA, h.id).expect(200);
      await checkOut(guardB, open.body.data.visit.id).expect(404);
      await checkOut(guardA, open.body.data.visit.id).expect(200);
    });
  });

  describe('my household’s controls', () => {
    it('shows the visits of my own helper, and a stranger gets "not found"', async () => {
      const res = await http().get(`/api/v1/domestic-helpers/${lakshmiId}/visits`).set(auth(resA1)).expect(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);
      const stranger = await add(resB1, { name: 'Someone Else', role: 'MAID' }).expect(201);
      await http().get(`/api/v1/domestic-helpers/${stranger.body.data.helper.id}/visits`).set(auth(resA1)).expect(404);
      await http().get(`/api/v1/domestic-helpers/${lakshmiId}/visits`).set(auth(resB1)).expect(404);
    });

    it('a new code replaces the old one at once, and only my own helper’s', async () => {
      const res = await http().post(`/api/v1/domestic-helpers/${lakshmiId}/new-code`).set(auth(resA2)).send({}).expect(200);
      const fresh = res.body.data.code;
      expect(fresh).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      await scan(guardA, lakshmiCode).expect(400);
      const ok = await scan(guardA, fresh).expect(200);
      await checkOut(guardA, ok.body.data.visit.id).expect(200);
      lakshmiCode = fresh;
      await http().post(`/api/v1/domestic-helpers/${lakshmiId}/new-code`).set(auth(resB1)).send({}).expect(404);
    });

    it('removing her from one flat keeps her on the other; with no flat left she cannot be let in; adding her again works', async () => {
      await http().post(`/api/v1/domestic-helpers/${lakshmiId}/remove`).set(auth(resA1)).send({}).expect(200);
      const mine = await http().get('/api/v1/domestic-helpers/my').set(auth(resA1)).expect(200);
      expect(mine.body.data.map((h: any) => h.id)).not.toContain(lakshmiId);
      await http().post(`/api/v1/domestic-helpers/${lakshmiId}/remove`).set(auth(resA1)).send({}).expect(404);
      const gate = await http().get('/api/v1/gate/helpers?search=Lakshmi').set(auth(guardA)).expect(200);
      expect(gate.body.data.find((h: any) => h.id === lakshmiId).flatCodes).toEqual(['HA-102']);

      await http().post(`/api/v1/domestic-helpers/${lakshmiId}/remove`).set(auth(resA2)).send({}).expect(200);
      await checkInById(guardA, lakshmiId).expect(409);
      const gone = await http().get('/api/v1/gate/helpers?search=Lakshmi').set(auth(guardA)).expect(200);
      expect(gone.body.data.map((h: any) => h.id)).not.toContain(lakshmiId);

      const back = await add(resA1, { name: 'Lakshmi', role: 'MAID', phone: LAKSHMI }).expect(201);
      expect(back.body.data.linked).toBe(true);
      expect(back.body.data.helper.id).toBe(lakshmiId);
      await checkInById(guardA, lakshmiId).expect(200).then((r) => checkOut(guardA, r.body.data.visit.id).expect(200));
    });
  });

  describe('the committee', () => {
    it('reads the register and the attendance log; residents and guards cannot', async () => {
      const reg = await http().get('/api/v1/domestic-helpers?search=lakshmi').set(auth(adminA)).expect(200);
      const l = reg.body.data.find((h: any) => h.id === lakshmiId);
      expect(l).toMatchObject({ name: 'Lakshmi', role: 'MAID', status: 'ACTIVE', verified: false });
      expect(l.flatCodes).toEqual(['HA-101']);
      expect(l).not.toHaveProperty('codeHash');
      const byPhone = await http().get(`/api/v1/domestic-helpers?search=${LAKSHMI}`).set(auth(adminA)).expect(200);
      expect(byPhone.body.data.map((h: any) => h.id)).toContain(lakshmiId);

      const log = await http().get(`/api/v1/domestic-helper-visits?helperId=${lakshmiId}`).set(auth(adminA)).expect(200);
      expect(log.body.data.length).toBeGreaterThanOrEqual(3);
      expect(log.body.data[0].name).toBe('Lakshmi');
      expect(log.body.data.some((v: any) => v.checkedInBy && /hguarda/.test(v.checkedInBy))).toBe(true);

      for (const t of [resA1, guardA]) {
        await http().get('/api/v1/domestic-helpers').set(auth(t)).expect(403);
        await http().get('/api/v1/domestic-helper-visits').set(auth(t)).expect(403);
      }
      const other = await http().get('/api/v1/domestic-helpers').set(auth(adminB)).expect(200);
      expect(other.body.data.map((h: any) => h.id)).not.toContain(lakshmiId);
    });

    it('verifies a person once', async () => {
      const res = await http().post(`/api/v1/domestic-helpers/${lakshmiId}/verify`).set(auth(adminA)).send({}).expect(200);
      expect(res.body.data.verified).toBe(true);
      await http().post(`/api/v1/domestic-helpers/${lakshmiId}/verify`).set(auth(adminA)).send({}).expect(200);
      expect(await prisma.auditLog.count({ where: { entityId: lakshmiId, societyId: societyA, newValues: { path: ['action'], equals: 'HELPER_VERIFIED' } } })).toBe(1);
      await http().post(`/api/v1/domestic-helpers/${lakshmiId}/verify`).set(auth(adminB)).send({}).expect(404);
      await http().post(`/api/v1/domestic-helpers/${lakshmiId}/verify`).set(auth(resA1)).send({}).expect(403);
    });

    it('suspends with a reason: the gate refuses her by id and by code; reinstating lets her in again', async () => {
      await http().post(`/api/v1/domestic-helpers/${lakshmiId}/suspend`).set(auth(adminA)).send({}).expect(400);
      await http().post(`/api/v1/domestic-helpers/${lakshmiId}/suspend`).set(auth(resA1)).send({ reason: 'I want to' }).expect(403);
      await http().post(`/api/v1/domestic-helpers/${lakshmiId}/suspend`).set(auth(guardA)).send({ reason: 'I want to' }).expect(403);
      await http().post(`/api/v1/domestic-helpers/${lakshmiId}/suspend`).set(auth(adminB)).send({ reason: 'Not mine to suspend' }).expect(404);

      const res = await http().post(`/api/v1/domestic-helpers/${lakshmiId}/suspend`).set(auth(adminA)).send({ reason: 'Seen taking things from a flat' }).expect(200);
      expect(res.body.data.status).toBe('SUSPENDED');
      await http().post(`/api/v1/domestic-helpers/${lakshmiId}/suspend`).set(auth(adminA)).send({ reason: 'Again' }).expect(409);

      const refused = await checkInById(guardA, lakshmiId).expect(403);
      expect(refused.body.message).toMatch(/suspended/);
      await scan(guardA, lakshmiCode).expect(403);
      const mine = await http().get('/api/v1/domestic-helpers/my').set(auth(resA1)).expect(200);
      expect(mine.body.data.find((h: any) => h.id === lakshmiId)).toMatchObject({ status: 'SUSPENDED', suspendedReason: 'Seen taking things from a flat' });

      await http().post(`/api/v1/domestic-helpers/${lakshmiId}/reinstate`).set(auth(adminA)).send({}).expect(200);
      await http().post(`/api/v1/domestic-helpers/${lakshmiId}/reinstate`).set(auth(adminA)).send({}).expect(409);
      const ok = await checkInById(guardA, lakshmiId).expect(200);
      await checkOut(guardA, ok.body.data.visit.id).expect(200);
    });

    it('keeps an audit trail of who did what', async () => {
      const rows = await prisma.auditLog.findMany({ where: { societyId: societyA, entityType: { in: ['DomesticHelper', 'DomesticHelperVisit'] } } });
      const actions = new Set(rows.map((r) => (r.newValues as any)?.action));
      for (const a of ['HELPER_ADDED', 'HELPER_LINKED', 'HELPER_UNLINKED', 'HELPER_CODE_REISSUED', 'HELPER_CHECKED_IN', 'HELPER_CHECKED_OUT', 'HELPER_VERIFIED', 'HELPER_SUSPENDED', 'HELPER_REINSTATED']) {
        expect(actions).toContain(a);
      }
      // Nothing secret is written to the trail: no hash, and neither the first nor the reissued code.
      const trail = JSON.stringify(rows);
      expect(trail).not.toContain('codeHash');
      for (const c of [firstCode, lakshmiCode]) expect(trail).not.toContain(c.replace('-', ''));
    });
  });
});
