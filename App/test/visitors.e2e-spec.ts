/**
 * Visitor and gate management against a REAL Postgres, through real HTTP.
 *
 * The unit tests run the service against an in-memory fake, which cannot prove
 * the one thing the gate depends on most: that spending an invitation code is
 * one atomic statement in the database. This does, by firing many scans of the
 * same code at once and counting what the database actually recorded.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 *
 * Rate limiting is neutralised for this file only (the counters, not the guard),
 * because proving atomicity needs bursts well over the production limits; the
 * limits themselves are asserted by metadata in src/visitors/visitors.http.spec.ts.
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
// Phones are unique in the database, so they must differ on every run (emails already do).
const phone = (n: number) => '91' + String(UNIQUE).slice(-7) + String(n);
const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('Visitor and gate management (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  // Society A
  let adminA: string;
  let societyA: string;
  let flatA1: string; // resA1 and resA1b live here
  let flatA2: string; // resA2 lives here
  let resA1: string;
  let resA1b: string;
  let resA2: string;
  let guardA: string;
  // Society B
  let adminB: string;
  let societyB: string;
  let flatB1: string;
  let guardB: string;
  let resB1: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const invite = (token: string, body: Record<string, unknown>) => http().post('/api/v1/visitor-invitations').set(auth(token)).send(body);
  const scan = (token: string, code: string, clientRequestId: string) => http().post('/api/v1/gate/scan').set(auth(token)).send({ code, clientRequestId });
  const walkIn = (token: string, body: Record<string, unknown>) => http().post('/api/v1/gate/walk-ins').set(auth(token)).send(body);
  const newInvitation = async (token: string, over: Record<string, unknown> = {}) => {
    const res = await invite(token, { visitorName: 'Ravi Kumar', validUntil: hours(3), ...over }).expect(201);
    return res.body.data as { id: string; code: string; maxUses: number };
  };
  let seq = 0;
  const rid = (p: string) => `${p}-${UNIQUE}-${++seq}`;

  async function makeUser(label: string, societyId: string, role: SystemRole, flatId: string | null): Promise<string> {
    const email = `${label}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: { email, firstName: label, lastName: 'Test', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId, role, status: 'ACTIVE', isPrimary: role === SystemRole.RESIDENT } });
    const login = await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200);
    expect(login.body.data.accessToken).toBeDefined();
    return login.body.data.accessToken as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60 }) })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // The same pipe settings as main.ts, so request-shape rules are the production ones.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = moduleFixture.get(PrismaService);

    const register = async (tag: string, phone: string) =>
      http()
        .post('/api/v1/auth/register-society')
        .send({
          society: { name: `E2E Gate ${tag} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-${tag}-${UNIQUE}@test.example`, contactPhone: phone },
          admin: { firstName: 'Admin', lastName: tag, email: `admin-${tag}-${UNIQUE}@test.example`, phone, password: PASSWORD },
        })
        .expect(201);

    const a = await register('a', phone(1));
    adminA = a.body.data.accessToken;
    societyA = a.body.data.memberships[0].societyId;
    const b = await register('b', phone(2));
    adminB = b.body.data.accessToken;
    societyB = b.body.data.memberships[0].societyId;

    const flat = async (token: string, building: string, unit: string, code: string) => {
      const bRes = await http().post('/api/v1/buildings').set(auth(token)).send({ name: building, code: building }).expect(201);
      const fRes = await http().post('/api/v1/flats').set(auth(token)).send({ buildingId: bRes.body.data.id, unitNumber: unit, flatCode: code }).expect(201);
      return { buildingId: bRes.body.data.id as string, flatId: fRes.body.data.id as string };
    };
    const a1 = await flat(adminA, 'TA', '101', 'TA-101');
    flatA1 = a1.flatId;
    const a2 = await http().post('/api/v1/flats').set(auth(adminA)).send({ buildingId: a1.buildingId, unitNumber: '102', flatCode: 'TA-102' }).expect(201);
    flatA2 = a2.body.data.id;
    flatB1 = (await flat(adminB, 'TB', '101', 'TB-101')).flatId;

    resA1 = await makeUser('resa1', societyA, SystemRole.RESIDENT, flatA1);
    resA1b = await makeUser('resa1b', societyA, SystemRole.RESIDENT, flatA1);
    resA2 = await makeUser('resa2', societyA, SystemRole.RESIDENT, flatA2);
    guardA = await makeUser('guarda', societyA, SystemRole.SECURITY_GUARD, null);
    guardB = await makeUser('guardb', societyB, SystemRole.SECURITY_GUARD, null);
    resB1 = await makeUser('resb1', societyB, SystemRole.RESIDENT, flatB1);
  });

  afterAll(async () => {
    if (societyA) await prisma.society.update({ where: { id: societyA }, data: { deletedAt: new Date() } });
    if (societyB) await prisma.society.update({ where: { id: societyB }, data: { deletedAt: new Date() } });
    await app.close();
  });

  // ── the database itself ──────────────────────────────────────────────────

  describe('the migration, on a real database', () => {
    it('accepts the new role (the enum value was added)', async () => {
      const roles = await prisma.$queryRaw<{ e: string }[]>`SELECT unnest(enum_range(NULL::"SystemRole"))::text AS e`;
      expect(roles.map((r) => r.e)).toContain('SECURITY_GUARD');
    });

    it('refuses an invitation that ends before it starts (CHECK constraint)', async () => {
      await expect(
        prisma.visitorInvitation.create({
          data: { societyId: societyA, flatId: flatA1, createdById: 'x', visitorName: 'Bad', validFrom: new Date(Date.now() + 3_600_000), validUntil: new Date(), codeHash: `bad-${UNIQUE}-1` },
        }),
      ).rejects.toThrow();
    });

    it('refuses an invitation with no uses left to give (CHECK constraint)', async () => {
      await expect(
        prisma.visitorInvitation.create({
          data: { societyId: societyA, flatId: flatA1, createdById: 'x', visitorName: 'Bad', validFrom: new Date(), validUntil: new Date(Date.now() + 3_600_000), maxUses: 0, codeHash: `bad-${UNIQUE}-2` },
        }),
      ).rejects.toThrow();
    });

    it('refuses two entries with the same retry id in one society, but allows it across societies', async () => {
      const row = (societyId: string, flatId: string) => ({ societyId, flatId, visitorName: 'Dup', clientRequestId: `dup-${UNIQUE}` });
      await prisma.visitorEntry.create({ data: row(societyA, flatA1) });
      await expect(prisma.visitorEntry.create({ data: row(societyA, flatA1) })).rejects.toThrow();
      await expect(prisma.visitorEntry.create({ data: row(societyB, flatB1) })).resolves.toBeDefined();
    });
  });

  // ── invitations ──────────────────────────────────────────────────────────

  describe('invitations', () => {
    it('shows the code once, and the database holds only a hash of it', async () => {
      const made = await newInvitation(resA1);
      expect(made.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      const stored = await prisma.visitorInvitation.findUniqueOrThrow({ where: { id: made.id } });
      expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(made.code.replace('-', ''));

      const list = await http().get('/api/v1/visitor-invitations/my').set(auth(resA1)).expect(200);
      const text = JSON.stringify(list.body);
      expect(text).not.toContain(made.code);
      expect(text).not.toContain('codeHash');
    });

    it('puts the invitation on the inviter\'s own flat, whatever the body says', async () => {
      const res = await invite(resA1, { visitorName: 'Sneaky', validUntil: hours(2), flatId: flatA2 });
      expect(res.status).toBe(400); // a body may not even name a flat
      const made = await newInvitation(resA1);
      const stored = await prisma.visitorInvitation.findUniqueOrThrow({ where: { id: made.id } });
      expect(stored).toMatchObject({ flatId: flatA1, societyId: societyA });
    });

    it('is shared by the household but not visible to another flat or another society', async () => {
      const made = await newInvitation(resA1, { visitorName: 'Household guest' });
      const sameFlat = await http().get('/api/v1/visitor-invitations/my').set(auth(resA1b)).expect(200);
      expect(sameFlat.body.data.map((i: any) => i.id)).toContain(made.id);
      for (const t of [resA2, resB1]) {
        const other = await http().get('/api/v1/visitor-invitations/my').set(auth(t)).expect(200);
        expect(other.body.data.map((i: any) => i.id)).not.toContain(made.id);
      }
    });

    it('cannot be cancelled by another flat', async () => {
      const made = await newInvitation(resA1);
      await http().post(`/api/v1/visitor-invitations/${made.id}/revoke`).set(auth(resA2)).expect(404);
      await http().post(`/api/v1/visitor-invitations/${made.id}/revoke`).set(auth(resA1b)).expect(200);
    });

    it('is refused for gate staff even though they hold a flat-less membership', async () => {
      await invite(guardA, { visitorName: 'Xavier', validUntil: hours(2) }).expect(403);
    });

    it('is bounded by the society\'s rules', async () => {
      await invite(resA1, { visitorName: 'Long', validUntil: hours(24 * 9) }).expect(400);
      await invite(resA1, { visitorName: 'Many', validUntil: hours(2), maxUses: 11 }).expect(400);
    });
  });

  // ── scanning: the atomic claim ───────────────────────────────────────────

  describe('scanning a code', () => {
    it('admits a valid code once: checked in, the guard recorded, the use counted', async () => {
      const made = await newInvitation(resA1);
      const res = await scan(guardA, made.code, rid('s')).expect(200);
      expect(res.body.data.entry).toMatchObject({ status: 'CHECKED_IN', flatId: flatA1, decisionMethod: 'INVITATION' });
      const inv = await prisma.visitorInvitation.findUniqueOrThrow({ where: { id: made.id } });
      expect(inv.usedCount).toBe(1);
    });

    it('refuses a single-use code the second time', async () => {
      const made = await newInvitation(resA1);
      await scan(guardA, made.code, rid('s')).expect(200);
      const again = await scan(guardA, made.code, rid('s')).expect(409);
      expect(again.body.message).toMatch(/already been used/);
    });

    it('lets exactly ONE of ten simultaneous scans of a single-use code through', async () => {
      const made = await newInvitation(resA1, { visitorName: 'Burst' });
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => scan(guardA, made.code, rid(`burst${i}`))));
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(9);

      const inv = await prisma.visitorInvitation.findUniqueOrThrow({ where: { id: made.id } });
      expect(inv.usedCount).toBe(1);
      expect(await prisma.visitorEntry.count({ where: { invitationId: made.id } })).toBe(1);
    });

    it('lets exactly maxUses of twelve simultaneous scans through', async () => {
      const made = await newInvitation(resA1, { visitorName: 'Party', maxUses: 3 });
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => scan(guardA, made.code, rid(`party${i}`))));
      expect(results.filter((r) => r.status === 200)).toHaveLength(3);
      expect(results.filter((r) => r.status === 409)).toHaveLength(9);
      const inv = await prisma.visitorInvitation.findUniqueOrThrow({ where: { id: made.id } });
      expect(inv.usedCount).toBe(3);
      expect(await prisma.visitorEntry.count({ where: { invitationId: made.id } })).toBe(3);
    });

    it('treats six simultaneous copies of the SAME attempt as one: one entry, one use', async () => {
      const made = await newInvitation(resA1, { visitorName: 'Retry', maxUses: 5 });
      const id = rid('same');
      const results = await Promise.all(Array.from({ length: 6 }, () => scan(guardA, made.code, id)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(new Set(results.map((r) => r.body.data.entry.id)).size).toBe(1);
      const inv = await prisma.visitorInvitation.findUniqueOrThrow({ where: { id: made.id } });
      expect(inv.usedCount).toBe(1);
      expect(await prisma.visitorEntry.count({ where: { invitationId: made.id } })).toBe(1);
    });

    it('does not accept a code from another society, and spends nothing', async () => {
      const made = await newInvitation(resA1);
      const res = await scan(guardB, made.code, rid('x')).expect(400);
      expect(res.body.message).toMatch(/not valid for this society/);
      const inv = await prisma.visitorInvitation.findUniqueOrThrow({ where: { id: made.id } });
      expect(inv.usedCount).toBe(0);
    });

    it('refuses an expired invitation', async () => {
      const made = await newInvitation(resA1);
      await prisma.visitorInvitation.update({ where: { id: made.id }, data: { validUntil: new Date(Date.now() - 1000), validFrom: new Date(Date.now() - 3_600_000) } });
      const res = await scan(guardA, made.code, rid('x')).expect(409);
      expect(res.body.message).toMatch(/expired/);
    });

    it('refuses a cancelled invitation', async () => {
      const made = await newInvitation(resA1);
      await http().post(`/api/v1/visitor-invitations/${made.id}/revoke`).set(auth(resA1)).expect(200);
      const res = await scan(guardA, made.code, rid('x')).expect(409);
      expect(res.body.message).toMatch(/cancelled/);
    });

    it('refuses an invitation that has not started', async () => {
      const made = await newInvitation(resA1, { validFrom: hours(2), validUntil: hours(5) });
      const res = await scan(guardA, made.code, rid('x')).expect(409);
      expect(res.body.message).toMatch(/not valid yet/);
    });

    it('rejects a malformed or unknown code', async () => {
      await scan(guardA, 'nope', rid('x')).expect(400);
      await scan(guardA, 'AAAA-AAAA', rid('x')).expect(400);
    });

    it('is not available to residents', async () => {
      const made = await newInvitation(resA1);
      await scan(resA2, made.code, rid('x')).expect(403);
    });
  });

  // ── walk-ins and approval ────────────────────────────────────────────────

  describe('walk-in visitors', () => {
    const register = async (flatId: string, name = 'Cab Driver') => {
      const res = await walkIn(guardA, { flatId, visitorName: name, visitorType: 'CAB', clientRequestId: rid('w') }).expect(201);
      return res.body.data.entry as { id: string; status: string };
    };

    it('waits for the residents of that flat, and cannot be let in before they answer', async () => {
      const e = await register(flatA1);
      expect(e.status).toBe('PENDING_APPROVAL');
      const res = await http().post(`/api/v1/gate/visitors/${e.id}/check-in`).set(auth(guardA)).expect(409);
      expect(res.body.message).toMatch(/waiting for the resident/);
    });

    it('can be answered only by the flat it is for', async () => {
      const e = await register(flatA1);
      await http().post(`/api/v1/visitors/${e.id}/approve`).set(auth(resA2)).send({}).expect(404);
      await http().post(`/api/v1/visitors/${e.id}/approve`).set(auth(resB1)).send({}).expect(404);
      await http().post(`/api/v1/visitors/${e.id}/approve`).set(auth(resA1)).send({}).expect(200);
    });

    it('lets exactly one of two household members answer when both answer at once', async () => {
      const e = await register(flatA1, 'Both Answer');
      const [approve, reject] = await Promise.all([
        http().post(`/api/v1/visitors/${e.id}/approve`).set(auth(resA1)).send({}),
        http().post(`/api/v1/visitors/${e.id}/reject`).set(auth(resA1b)).send({}),
      ]);
      expect([approve.status, reject.status].sort()).toEqual([200, 409]);
      const stored = await prisma.visitorEntry.findUniqueOrThrow({ where: { id: e.id } });
      expect(['APPROVED', 'REJECTED']).toContain(stored.status);
      expect(stored.decidedById).toBeTruthy();
    });

    it('goes in, is recorded, and a double press is harmless', async () => {
      const e = await register(flatA1);
      await http().post(`/api/v1/visitors/${e.id}/approve`).set(auth(resA1)).send({}).expect(200);
      const first = await http().post(`/api/v1/gate/visitors/${e.id}/check-in`).set(auth(guardA)).expect(200);
      expect(first.body.data.status).toBe('CHECKED_IN');
      const again = await http().post(`/api/v1/gate/visitors/${e.id}/check-in`).set(auth(guardA)).expect(200);
      expect(again.body.data.status).toBe('CHECKED_IN');
      const out = await http().post(`/api/v1/gate/visitors/${e.id}/check-out`).set(auth(guardA)).expect(200);
      expect(out.body.data.status).toBe('CHECKED_OUT');
      await http().post(`/api/v1/gate/visitors/${e.id}/check-out`).set(auth(guardA)).expect(200);
    });

    it('cannot be let in after a decline', async () => {
      const e = await register(flatA1);
      await http().post(`/api/v1/visitors/${e.id}/reject`).set(auth(resA1)).send({}).expect(200);
      const res = await http().post(`/api/v1/gate/visitors/${e.id}/check-in`).set(auth(guardA)).expect(409);
      expect(res.body.message).toMatch(/declined/);
    });

    it('registering the same attempt twice at once makes one entry', async () => {
      const id = rid('dupwalk');
      const body = { flatId: flatA1, visitorName: 'Twice', clientRequestId: id };
      const results = await Promise.all(Array.from({ length: 5 }, () => walkIn(guardA, body)));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(await prisma.visitorEntry.count({ where: { societyId: societyA, clientRequestId: id } })).toBe(1);
    });

    it('refuses a flat from another society', async () => {
      await walkIn(guardA, { flatId: flatB1, visitorName: 'Wrong society', clientRequestId: rid('w') }).expect(404);
    });

    it('lapses when nobody answers in time, and can then no longer be answered', async () => {
      const e = await register(flatA1);
      await prisma.visitorEntry.update({ where: { id: e.id }, data: { requestedAt: new Date(Date.now() - 45 * 60_000) } });
      const res = await http().post(`/api/v1/visitors/${e.id}/approve`).set(auth(resA1)).send({}).expect(409);
      expect(res.body.message).toMatch(/expired/);
    });

    it('is admitted straight away when the society does not require approval — and the rule is restored after', async () => {
      await http().put('/api/v1/visitors/policy').set(auth(adminA)).send({ walkInApproval: 'NOT_REQUIRED' }).expect(200);
      try {
        const e = await register(flatA1, 'No approval');
        expect(e.status).toBe('APPROVED');
      } finally {
        await http().put('/api/v1/visitors/policy').set(auth(adminA)).send({ walkInApproval: 'REQUIRED' }).expect(200);
      }
      expect((await register(flatA1, 'Approval again')).status).toBe('PENDING_APPROVAL');
    });
  });

  // ── who can see and do what ──────────────────────────────────────────────

  describe('access', () => {
    it('shows a resident only their own flat\'s visitors', async () => {
      await walkIn(guardA, { flatId: flatA2, visitorName: 'For flat two only', clientRequestId: rid('w') }).expect(201);
      const mine = await http().get('/api/v1/visitors/my').set(auth(resA1)).expect(200);
      expect(mine.body.data.map((v: any) => v.visitorName)).not.toContain('For flat two only');
      const theirs = await http().get('/api/v1/visitors/my').set(auth(resA2)).expect(200);
      expect(theirs.body.data.map((v: any) => v.visitorName)).toContain('For flat two only');
    });

    it('keeps the gate to gate staff and the committee', async () => {
      await http().get('/api/v1/gate/visitors').set(auth(resA1)).expect(403);
      await walkIn(resA1, { flatId: flatA1, visitorName: 'X', clientRequestId: rid('w') }).expect(403);
      await http().get('/api/v1/gate/visitors').set(auth(guardA)).expect(200);
      await http().get('/api/v1/gate/visitors').set(auth(adminA)).expect(200);
    });

    it('gives the guard flats to choose from with no resident names', async () => {
      const res = await http().get('/api/v1/gate/flats').set(auth(guardA)).expect(200);
      const codes = res.body.data.map((f: any) => f.flatCode);
      expect(codes).toEqual(expect.arrayContaining(['TA-101', 'TA-102']));
      expect(codes).not.toContain('TB-101');
      expect(JSON.stringify(res.body)).not.toMatch(/resa1|Test/);
    });

    it('keeps the committee log to the committee, and to their own society', async () => {
      await http().get('/api/v1/visitors').set(auth(guardA)).expect(403);
      await http().get('/api/v1/visitors').set(auth(resA1)).expect(403);
      const a = await http().get('/api/v1/visitors').set(auth(adminA)).expect(200);
      expect(a.body.data.length).toBeGreaterThan(0);
      const b = await http().get('/api/v1/visitors').set(auth(adminB)).expect(200);
      const aIds = new Set(a.body.data.map((v: any) => v.id));
      expect(b.body.data.some((v: any) => aIds.has(v.id))).toBe(false);
    });

    it('lets the committee search the log', async () => {
      const res = await http().get('/api/v1/visitors').query({ search: 'ta-102' }).set(auth(adminA)).expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((v: any) => v.flatCode === 'TA-102')).toBe(true);
    });

    it('rejects a bad filter value cleanly', async () => {
      await http().get('/api/v1/visitors').query({ status: 'SOMETIMES' }).set(auth(adminA)).expect(400);
    });
  });

  // ── committee override ───────────────────────────────────────────────────

  describe('committee override', () => {
    it('decides an unanswered request with a recorded reason, once', async () => {
      const w = await walkIn(guardA, { flatId: flatA1, visitorName: 'Plumber', clientRequestId: rid('w') }).expect(201);
      const id = w.body.data.entry.id;
      await http().post(`/api/v1/visitors/${id}/override`).set(auth(resA1)).send({ action: 'APPROVE', reason: 'I want in' }).expect(403);
      await http().post(`/api/v1/visitors/${id}/override`).set(auth(guardA)).send({ action: 'APPROVE', reason: 'Let me in' }).expect(403);
      await http().post(`/api/v1/visitors/${id}/override`).set(auth(adminA)).send({ action: 'APPROVE' }).expect(400);
      const ok = await http().post(`/api/v1/visitors/${id}/override`).set(auth(adminA)).send({ action: 'APPROVE', reason: 'Arranged by the committee' }).expect(200);
      expect(ok.body.data).toMatchObject({ status: 'APPROVED', decisionMethod: 'ADMIN_OVERRIDE' });
      await http().post(`/api/v1/visitors/${id}/override`).set(auth(adminA)).send({ action: 'REJECT', reason: 'Changed my mind' }).expect(409);

      const audit = await prisma.auditLog.findFirst({ where: { entityId: id, societyId: societyA }, orderBy: { createdAt: 'desc' } });
      expect(audit?.newValues).toMatchObject({ action: 'VISITOR_OVERRIDE', reason: 'Arranged by the committee' });
    });

    it('cannot reach another society\'s visitor', async () => {
      const w = await walkIn(guardA, { flatId: flatA1, visitorName: 'A only', clientRequestId: rid('w') }).expect(201);
      await http().post(`/api/v1/visitors/${w.body.data.entry.id}/override`).set(auth(adminB)).send({ action: 'APPROVE', reason: 'Not mine to decide' }).expect(404);
    });
  });

  // ── the trail ────────────────────────────────────────────────────────────

  describe('audit trail', () => {
    it('records who did each thing at the gate', async () => {
      const made = await newInvitation(resA1, { visitorName: 'Audited' });
      const res = await scan(guardA, made.code, rid('x')).expect(200);
      const guardUser = await prisma.user.findFirstOrThrow({ where: { email: `guarda-${UNIQUE}@test.example` } });
      const audit = await prisma.auditLog.findFirst({ where: { entityId: res.body.data.entry.id, societyId: societyA } });
      expect(audit).toMatchObject({ actorId: guardUser.id });
      expect(audit?.newValues).toMatchObject({ action: 'VISITOR_CHECKED_IN', method: 'INVITATION' });
    });
  });
});
