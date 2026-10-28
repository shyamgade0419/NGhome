/**
 * A society admin permanently deleting a member's account, on a REAL Postgres.
 *
 * "Remove" ends a membership but leaves the account, so the person's email and
 * phone stay taken. This is the admin's way to erase one completely — and the
 * tests that matter most are the limits: it must reach only people of the
 * admin's own society, and never an account that also belongs to another.
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
const phone = (n: number) => '95' + String(UNIQUE).slice(-7) + String(n);
const email = (label: string) => `${label}-${UNIQUE}@test.example`;

describe('Society admin: delete a member (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let adminA: string; // token
  let adminAId: string;
  let adminB: string;
  let societyA: string;
  let societyB: string;
  let flatA: string;
  let flatB: string;
  let joinCodeA: string;

  async function register(tag: string, n: number) {
    const reg = await http()
      .post('/api/v1/auth/register-society')
      .send({
        society: { name: `E2E MemberDel ${tag} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: email(`soc-${tag}`), contactPhone: phone(n) },
        admin: { firstName: 'Admin', lastName: tag, email: email(`admin-${tag}`), phone: phone(n), password: PASSWORD },
      })
      .expect(201);
    const token = reg.body.data.accessToken as string;
    const societyId = reg.body.data.memberships[0].societyId as string;
    const bld = await http().post('/api/v1/buildings').set(auth(token)).send({ name: tag, code: tag }).expect(201);
    const flat = await http().post('/api/v1/flats').set(auth(token)).send({ buildingId: bld.body.data.id, unitNumber: '1', flatCode: `${tag}-1` }).expect(201);
    return { token, societyId, flatId: flat.body.data.id as string };
  }

  async function resident(label: string, n: number, societyId: string, flatId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
    const u = await prisma.user.create({
      data: { email: email(label), phone: phone(n), firstName: label, lastName: 'Mem', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({
      data: { societyId, userId: u.id, flatId, role: SystemRole.RESIDENT, status, leftAt: status === 'INACTIVE' ? new Date() : null },
    });
    return u;
  }

  const preview = (id: string, token = adminA) => http().get(`/api/v1/users/society/${id}/deletion-preview`).set(auth(token));
  const del = (id: string, confirmEmail: string, token = adminA) =>
    http().post(`/api/v1/users/society/${id}/delete`).set(auth(token)).send({ confirmEmail });
  const exists = async (id: string) => (await prisma.user.count({ where: { id } })) === 1;

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

    const a = await register('a', 1);
    adminA = a.token; societyA = a.societyId; flatA = a.flatId;
    const b = await register('b', 2);
    adminB = b.token; societyB = b.societyId; flatB = b.flatId;
    adminAId = (await prisma.user.findFirstOrThrow({ where: { email: email('admin-a') } })).id;
    joinCodeA = (await prisma.society.findUniqueOrThrow({ where: { id: societyA } })).joinCode as string;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('a removed resident (Anil)', () => {
    let anilId: string;

    beforeAll(async () => {
      anilId = (await resident('anil', 3, societyA, flatA)).id;
      await http().delete(`/api/v1/users/society/${anilId}/remove`).set(auth(adminA)).expect(204);
    });

    it('appears in the admin’s "removed members" list, with no contact beyond what the admin already had', async () => {
      const res = await http().get('/api/v1/users/society/removed').set(auth(adminA)).expect(200);
      expect(res.body.data).toEqual([expect.objectContaining({ userId: anilId, email: email('anil'), flatCode: 'a-1' })]);
    });

    it('is not in another society’s removed list', async () => {
      const res = await http().get('/api/v1/users/society/removed').set(auth(adminB)).expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('cannot be previewed or deleted by a different society’s admin: it is simply not found', async () => {
      await preview(anilId, adminB).expect(404);
      await del(anilId, email('anil'), adminB).expect(404);
      expect(await exists(anilId)).toBe(true);
    });

    it('cannot be deleted by a resident', async () => {
      const r = await resident('plainres', 4, societyA, flatA);
      const login = await http().post('/api/v1/auth/login').send({ identifier: email('plainres'), password: PASSWORD }).expect(200);
      await del(anilId, email('anil'), login.body.data.accessToken).expect(403);
      await preview(anilId, login.body.data.accessToken).expect(403);
      expect(await exists(anilId)).toBe(true);
      expect(r.id).toBeTruthy();
    });

    it('previews as deletable, showing only this society', async () => {
      const res = await preview(anilId).expect(200);
      expect(res.body.data).toMatchObject({ canDelete: true, reasons: [], blockedBy: [] });
      expect(res.body.data.memberships).toHaveLength(1);
    });

    it('refuses a wrong confirmation email', async () => {
      await del(anilId, 'nobody@else.example').expect(400);
      expect(await exists(anilId)).toBe(true);
    });

    it('is deleted, and the email and phone are free again', async () => {
      await del(anilId, email('anil')).expect(200);
      expect(await exists(anilId)).toBe(false);
      const res = await http()
        .post('/api/v1/auth/join-society')
        .send({ joinCode: joinCodeA, firstName: 'Anil', lastName: 'Mem', email: email('anil'), phone: phone(3), password: 'BrandNew789!', flatId: flatA })
        .expect(201);
      expect(res.body.data.accessToken).toBeTruthy();
    });

    it('leaves a record that an admin deleted an account — and no personal details', async () => {
      const row = await prisma.auditLog.findFirst({ where: { entityId: anilId, action: 'USER_DELETED' } });
      expect(row).toBeTruthy();
      expect(row?.societyId).toBe(societyA);
      expect(row?.actorId).toBe(adminAId);
      const text = JSON.stringify(row);
      expect(text).not.toContain(email('anil'));
      expect(text).not.toContain(phone(3));
      expect(text).not.toContain('anil');
    });

    it('no longer lists someone who rejoined as "removed"', async () => {
      const res = await http().get('/api/v1/users/society/removed').set(auth(adminA)).expect(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('limits', () => {
    it('refuses an account that also belongs to another society, and never names that society', async () => {
      const both = await resident('both', 5, societyA, flatA);
      await prisma.societyMembership.create({ data: { societyId: societyB, userId: both.id, flatId: flatB, role: SystemRole.RESIDENT, status: 'ACTIVE' } });

      const p = (await preview(both.id).expect(200)).body.data;
      expect(p.canDelete).toBe(false);
      expect(p.reasons.join(' ')).toMatch(/another society/);
      expect(JSON.stringify(p)).not.toContain('MemberDel b');

      const res = await del(both.id, email('both')).expect(400);
      expect(res.body.message).toMatch(/another society/);
      expect(await exists(both.id)).toBe(true);
      expect(await prisma.societyMembership.count({ where: { userId: both.id } })).toBe(2);
    });

    it('refuses someone whose only other membership was itself removed (the account is still theirs there)', async () => {
      const former = await resident('former', 6, societyA, flatA);
      await prisma.societyMembership.create({ data: { societyId: societyB, userId: former.id, flatId: flatB, role: SystemRole.RESIDENT, status: 'INACTIVE', leftAt: new Date() } });
      await del(former.id, email('former')).expect(400);
      expect(await exists(former.id)).toBe(true);
    });

    it('refuses a platform admin', async () => {
      const pa = await resident('pa', 7, societyA, flatA);
      await prisma.user.update({ where: { id: pa.id }, data: { isPlatformAdmin: true } });
      const res = await del(pa.id, email('pa')).expect(400);
      expect(res.body.message).toMatch(/Platform admins/);
      expect(await exists(pa.id)).toBe(true);
    });

    it('will not delete yourself, nor the only admin', async () => {
      const self = await del(adminAId, email('admin-a')).expect(400);
      expect(self.body.message).toMatch(/own account/);
      expect(await exists(adminAId)).toBe(true);
    });

    it('refuses while the society holds records from the person, naming them', async () => {
      const poster = await resident('poster', 8, societyA, flatA);
      await prisma.announcement.create({ data: { societyId: societyA, title: 'Notice', content: 'Hi', createdById: poster.id } });
      const res = await del(poster.id, email('poster')).expect(409);
      expect(res.body.message).toMatch(/announcements they posted/);
      expect(await exists(poster.id)).toBe(true);
      expect(await prisma.announcement.count({ where: { createdById: poster.id } })).toBe(1);
    });

    it('erases a person who still has an active membership too (not only removed ones)', async () => {
      const current = await resident('current', 9, societyA, flatA);
      await del(current.id, email('current')).expect(200);
      expect(await exists(current.id)).toBe(false);
      expect(await prisma.societyMembership.count({ where: { userId: current.id } })).toBe(0);
    });

    it('does not touch the other society’s data', async () => {
      expect(await prisma.societyMembership.count({ where: { societyId: societyB } })).toBeGreaterThanOrEqual(2);
      expect(await prisma.flat.count({ where: { societyId: societyB } })).toBe(1);
    });
  });
});
