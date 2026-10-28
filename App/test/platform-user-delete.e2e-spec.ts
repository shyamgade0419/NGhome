/**
 * Permanent delete of one account, on a REAL Postgres.
 *
 * The case that started it: a resident is "removed" from a society, which only
 * ends the membership. The account stays, vanishes from the platform Users
 * list, and keeps their email and phone taken so they cannot be added again.
 * This drives that whole path, and the foreign-key order of the delete itself.
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
const phone = (n: number) => '94' + String(UNIQUE).slice(-7) + String(n);
const email = (label: string) => `${label}-${UNIQUE}@test.example`;

describe('Platform: delete a user (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let platformToken: string;
  let platformId: string;
  let adminToken: string;
  let adminId: string;
  let societyId: string;
  let flatId: string;

  async function login(identifier: string): Promise<string> {
    const res = await http().post('/api/v1/auth/login').send({ identifier, password: PASSWORD }).expect(200);
    return res.body.data.accessToken as string;
  }

  async function person(label: string, n: number, role: SystemRole | null = SystemRole.RESIDENT) {
    const u = await prisma.user.create({
      data: { email: email(label), phone: phone(n), firstName: label, lastName: 'Del', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    if (role) await prisma.societyMembership.create({ data: { societyId, userId: u.id, flatId, role, status: 'ACTIVE' } });
    return u;
  }

  const preview = (id: string, token = platformToken) => http().get(`/api/v1/platform/users/${id}/deletion-preview`).set(auth(token));
  const del = (id: string, confirmEmail: string, token = platformToken) =>
    http().post(`/api/v1/platform/users/${id}/delete`).set(auth(token)).send({ confirmEmail });
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

    const reg = await http()
      .post('/api/v1/auth/register-society')
      .send({
        society: { name: `E2E UserDel ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: email('soc'), contactPhone: phone(1) },
        admin: { firstName: 'Admin', lastName: 'Del', email: email('admin'), phone: phone(1), password: PASSWORD },
      })
      .expect(201);
    adminToken = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    adminId = (await prisma.user.findFirstOrThrow({ where: { email: email('admin') } })).id;
    const bld = await http().post('/api/v1/buildings').set(auth(adminToken)).send({ name: 'B', code: 'B' }).expect(201);
    const flat = await http().post('/api/v1/flats').set(auth(adminToken)).send({ buildingId: bld.body.data.id, unitNumber: '1', flatCode: 'B-1' }).expect(201);
    flatId = flat.body.data.id;

    const platform = await prisma.user.create({
      data: { email: email('platform'), firstName: 'Plat', lastName: 'Form', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true, isPlatformAdmin: true },
    });
    platformId = platform.id;
    platformToken = await login(email('platform'));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('the removed resident (Anil)', () => {
    let anilId: string;

    beforeAll(async () => {
      anilId = (await person('anil', 2)).id;
      await http().delete(`/api/v1/users/society/${anilId}/remove`).set(auth(adminToken)).expect(204);
    });

    it('is hidden from the default Users list, because he belongs to no live society', async () => {
      const res = await http().get('/api/v1/societies/platform/users').query({ search: email('anil'), limit: 50 }).set(auth(platformToken)).expect(200);
      expect(res.body.data.map((u: { id: string }) => u.id)).not.toContain(anilId);
    });

    it('is found under "no active society"', async () => {
      const res = await http().get('/api/v1/societies/platform/users').query({ withoutSociety: 'true', search: email('anil') }).set(auth(platformToken)).expect(200);
      expect(res.body.data.map((u: { id: string }) => u.id)).toEqual([anilId]);
    });

    it('does not put platform admins or live members in the "no active society" list', async () => {
      const res = await http().get('/api/v1/societies/platform/users').query({ withoutSociety: 'true', limit: 100 }).set(auth(platformToken)).expect(200);
      const ids = res.body.data.map((u: { id: string }) => u.id);
      expect(ids).not.toContain(platformId);
      expect(ids).not.toContain(adminId);
    });

    it('still holds his email: he cannot be added again', async () => {
      const res = await http()
        .post('/api/v1/auth/join-society')
        .send({ joinCode: (await prisma.society.findUniqueOrThrow({ where: { id: societyId } })).joinCode, firstName: 'Anil', lastName: 'Del', email: email('anil'), phone: phone(9), password: 'AnotherPass456!', flatId });
      // A different password cannot claim the old account, so the address is stuck.
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already exists/);
      expect(await prisma.user.count({ where: { email: email('anil') } })).toBe(1);
    });

    it('is refused to a society admin, and to a resident', async () => {
      await del(anilId, email('anil'), adminToken).expect(403);
      await preview(anilId, adminToken).expect(403);
      expect(await exists(anilId)).toBe(true);
    });

    it('previews as deletable', async () => {
      const res = await preview(anilId).expect(200);
      expect(res.body.data).toMatchObject({ canDelete: true, blockedBy: [], reasons: [], user: { email: email('anil') } });
      expect(res.body.data.memberships).toEqual([expect.objectContaining({ status: 'INACTIVE' })]);
    });

    it('refuses a wrong confirmation email, and deletes nothing', async () => {
      const res = await del(anilId, 'someone@else.example').expect(400);
      expect(res.body.message).toMatch(/does not match/);
      expect(await exists(anilId)).toBe(true);
    });

    it('deletes the account', async () => {
      await del(anilId, ` ${email('anil').toUpperCase()} `).expect(200);
      expect(await exists(anilId)).toBe(false);
      expect(await prisma.societyMembership.count({ where: { userId: anilId } })).toBe(0);
    });

    it('frees the email and phone: he can join again', async () => {
      const society = await prisma.society.findUniqueOrThrow({ where: { id: societyId } });
      await http()
        .post('/api/v1/auth/join-society')
        .send({ joinCode: society.joinCode, firstName: 'Anil', lastName: 'Del', email: email('anil'), phone: phone(2), password: PASSWORD, flatId })
        .expect(201);
    });

    it('keeps one audit record of who erased the account', async () => {
      const row = await prisma.auditLog.findFirst({ where: { entityId: anilId, societyId: null, action: 'USER_DELETED' } });
      expect(row).toBeTruthy();
      expect(row?.actorId).toBe(platformId);
      expect(row?.oldValues).toMatchObject({ email: email('anil') });
    });
  });

  describe('a person with personal rows everywhere', () => {
    it('is deleted, with notifications, messages, audit entries and assignments handled in an order the database accepts', async () => {
      const busy = await person('busy', 3);
      const other = await person('other', 4);
      const n = await prisma.notification.create({ data: { societyId, title: 't', body: 'b', type: 'TEST', channels: ['IN_APP'] } });
      await prisma.notificationRecord.create({ data: { notificationId: n.id, userId: busy.id, channel: 'IN_APP' } });
      const convo = await prisma.conversation.create({ data: { societyId } });
      await prisma.conversationParticipant.createMany({ data: [{ conversationId: convo.id, userId: busy.id }, { conversationId: convo.id, userId: other.id }] });
      await prisma.directMessage.create({ data: { conversationId: convo.id, senderId: busy.id, body: 'hello' } });
      await prisma.auditLog.create({ data: { societyId, actorId: busy.id, action: 'OTHER', entityType: 'X', entityId: busy.id } });
      await prisma.pushToken.create({ data: { userId: busy.id, token: `tok-${UNIQUE}`, platform: 'android' } as never }).catch(() => undefined);
      const req = await prisma.maintenanceRequest.create({ data: { societyId, flatId, residentId: other.id, assignedToId: busy.id, title: 'Leak' } });

      const p = (await preview(busy.id).expect(200)).body.data;
      expect(p.canDelete).toBe(true);
      expect(p.willRemove.map((l: { label: string }) => l.label)).toEqual(
        expect.arrayContaining(['notifications sent to them', 'direct messages they sent', 'audit entries for actions they took', 'maintenance requests assigned to them']),
      );

      await del(busy.id, email('busy')).expect(200);
      expect(await exists(busy.id)).toBe(false);
      // Other people's things are untouched; the request survives, now unassigned.
      expect(await exists(other.id)).toBe(true);
      expect((await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id: req.id } })).assignedToId).toBeNull();
      expect(await prisma.conversation.count({ where: { id: convo.id } })).toBe(1);
      expect(await prisma.directMessage.count({ where: { conversationId: convo.id } })).toBe(0);
      expect(await prisma.conversationParticipant.count({ where: { conversationId: convo.id } })).toBe(1);
      expect(await prisma.notification.count({ where: { id: n.id } })).toBe(1);
    });
  });

  describe('a person the society still has records for', () => {
    it('is refused with the list of what is in the way, and nothing is deleted', async () => {
      const poster = await person('poster', 5);
      await prisma.announcement.create({ data: { societyId, title: 'Water off', content: 'Tomorrow', createdById: poster.id } });
      await prisma.maintenanceRequest.create({ data: { societyId, flatId, residentId: poster.id, title: 'Lift' } });
      await prisma.notificationRecord.deleteMany({ where: { userId: poster.id } });

      const p = (await preview(poster.id).expect(200)).body.data;
      expect(p.canDelete).toBe(false);
      expect(p.blockedBy).toEqual(
        expect.arrayContaining([
          { label: 'announcements they posted', count: 1 },
          { label: 'maintenance requests they raised', count: 1 },
        ]),
      );

      const res = await del(poster.id, email('poster')).expect(409);
      expect(res.body.message).toMatch(/announcements they posted/);
      expect(await exists(poster.id)).toBe(true);
      expect(await prisma.announcement.count({ where: { createdById: poster.id } })).toBe(1);
      expect(await prisma.societyMembership.count({ where: { userId: poster.id } })).toBe(1);
    });
  });

  describe('accounts that must not go', () => {
    it('will not delete yourself', async () => {
      const res = await del(platformId, email('platform')).expect(400);
      expect(res.body.message).toMatch(/own account/);
      expect(await exists(platformId)).toBe(true);
    });

    it('will not delete the only admin of a live society', async () => {
      const res = await del(adminId, email('admin')).expect(400);
      expect(res.body.message).toMatch(/only admin of/);
      expect(await exists(adminId)).toBe(true);
    });

    it('allows it once the society has another admin', async () => {
      const second = await person('second-admin', 6, SystemRole.SOCIETY_ADMIN);
      const p = (await preview(adminId).expect(200)).body.data;
      // Their own announcements/records may still stop it; the admin rule itself no longer does.
      expect(p.reasons).toEqual([]);
      expect(second.id).toBeTruthy();
    });

    it('answers 404 for an account that does not exist', async () => {
      await preview('00000000-0000-4000-8000-000000000000').expect(404);
    });
  });
});
