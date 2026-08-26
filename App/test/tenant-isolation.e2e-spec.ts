/**
 * API-level tenant isolation e2e tests.
 * Two independent societies are registered; each society's admin attempts to read
 * the other society's data through real HTTP endpoints with proper JWT auth.
 * Every cross-tenant access must return 403 or 404.
 *
 * Run with: npm run test:e2e
 * Requires DATABASE_URL pointing to a test database.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const UNIQUE = Date.now();

describe('API Tenant Isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Society A context
  let tokenA: string;
  let societyAId: string;
  let buildingAId: string;
  let flatAId: string;
  let announcementAId: string;
  let billingPeriodAId: string;

  // Society B context
  let tokenB: string;
  let societyBId: string;
  let buildingBId: string;
  let flatBId: string;
  let announcementBId: string;
  let billingPeriodBId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    if (societyAId) await prisma.society.update({ where: { id: societyAId }, data: { deletedAt: new Date() } });
    if (societyBId) await prisma.society.update({ where: { id: societyBId }, data: { deletedAt: new Date() } });
    await app.close();
  });

  // ─── Setup ────────────────────────────────────────────────────────────────

  describe('Setup', () => {
    // DEFECT-5: Extract societyId from memberships[0].societyId, NOT user.societyId
    // (UserDto does not expose societyId — only MembershipDto does)
    it('registers Society A and returns a scoped JWT', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register-society')
        .send({
          society: {
            name: `E2E Society A ${UNIQUE}`,
            address: '1 A Street',
            city: 'Chennai',
            state: 'TN',
            pinCode: '600001',
            country: 'India',
            contactEmail: `soc-a-${UNIQUE}@test.example`,
            contactPhone: '9000000001',
          },
          admin: {
            firstName: 'Admin',
            lastName: 'A',
            email: `admin-a-${UNIQUE}@test.example`,
            phone: '9000000001',
            password: 'TestPass123!',
          },
        })
        .expect(201);

      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.memberships).toBeDefined();
      expect(res.body.data.memberships[0].societyId).toBeDefined();
      tokenA = res.body.data.accessToken;
      societyAId = res.body.data.memberships[0].societyId;
    });

    it('registers Society B and returns a scoped JWT', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register-society')
        .send({
          society: {
            name: `E2E Society B ${UNIQUE}`,
            address: '2 B Avenue',
            city: 'Mumbai',
            state: 'MH',
            pinCode: '400001',
            country: 'India',
            contactEmail: `soc-b-${UNIQUE}@test.example`,
            contactPhone: '9000000002',
          },
          admin: {
            firstName: 'Admin',
            lastName: 'B',
            email: `admin-b-${UNIQUE}@test.example`,
            phone: '9000000002',
            password: 'TestPass123!',
          },
        })
        .expect(201);

      tokenB = res.body.data.accessToken;
      societyBId = res.body.data.memberships[0].societyId;
      expect(societyBId).not.toBe(societyAId);
    });

    it('creates a building and flat in Society A', async () => {
      const bRes = await request(app.getHttpServer())
        .post('/api/v1/buildings')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Tower A', code: 'TA' })
        .expect(201);
      buildingAId = bRes.body.data.id;

      const fRes = await request(app.getHttpServer())
        .post('/api/v1/flats')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ buildingId: buildingAId, unitNumber: '101', flatCode: 'TA-101' })
        .expect(201);
      flatAId = fRes.body.data.id;
    });

    it('creates a building and flat in Society B', async () => {
      const bRes = await request(app.getHttpServer())
        .post('/api/v1/buildings')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Tower B', code: 'TB' })
        .expect(201);
      buildingBId = bRes.body.data.id;

      const fRes = await request(app.getHttpServer())
        .post('/api/v1/flats')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ buildingId: buildingBId, unitNumber: '101', flatCode: 'TB-101' })
        .expect(201);
      flatBId = fRes.body.data.id;
    });

    it('creates an announcement in each society', async () => {
      const aRes = await request(app.getHttpServer())
        .post('/api/v1/announcements')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ title: 'Society A Only', content: 'Secret A content', audience: 'ALL' })
        .expect(201);
      announcementAId = aRes.body.data.id;

      const bRes = await request(app.getHttpServer())
        .post('/api/v1/announcements')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ title: 'Society B Only', content: 'Secret B content', audience: 'ALL' })
        .expect(201);
      announcementBId = bRes.body.data.id;
    });

    it('creates a billing period in each society', async () => {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const start = `${y}-${m}-01`;
      const end = `${y}-${m}-28`;
      const due = `${y}-${m}-15`;

      const aRes = await request(app.getHttpServer())
        .post('/api/v1/billing/periods')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1, startDate: start, endDate: end, dueDate: due })
        .expect(201);
      billingPeriodAId = aRes.body.data.id;

      const bRes = await request(app.getHttpServer())
        .post('/api/v1/billing/periods')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1, startDate: start, endDate: end, dueDate: due })
        .expect(201);
      billingPeriodBId = bRes.body.data.id;
    });
  });

  // ─── Cross-tenant reads rejected ──────────────────────────────────────────

  describe('Cross-tenant reads are rejected (A → B)', () => {
    it('cannot read Society B building by ID', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/buildings/${buildingBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect((res) => { expect([403, 404]).toContain(res.status); });
    });

    it('cannot read Society B flat by ID', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/flats/${flatBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect((res) => { expect([403, 404]).toContain(res.status); });
    });

    it('cannot read Society B announcement by ID', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/announcements/${announcementBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect((res) => { expect([403, 404]).toContain(res.status); });
    });

    it('cannot read Society B billing period by ID', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/billing/periods/${billingPeriodBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect((res) => { expect([403, 404]).toContain(res.status); });
    });

    it('cannot generate bills for Society B billing period', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/billing/periods/${billingPeriodBId}/generate`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect((res) => { expect([403, 404]).toContain(res.status); });
    });

    it('cannot record water reading for Society B flat', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/water/readings')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          flatId: flatBId,
          readingDate: new Date().toISOString().split('T')[0],
          openingReading: 100,
          closingReading: 120,
        })
        .expect((res) => { expect([403, 404]).toContain(res.status); });
    });
  });

  describe('Cross-tenant reads are rejected (B → A)', () => {
    it('cannot read Society A announcement by ID', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/announcements/${announcementAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect((res) => { expect([403, 404]).toContain(res.status); });
    });

    it('cannot read Society A billing period by ID', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/billing/periods/${billingPeriodAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect((res) => { expect([403, 404]).toContain(res.status); });
    });

    it('cannot generate bills for Society A billing period', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/billing/periods/${billingPeriodAId}/generate`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect((res) => { expect([403, 404]).toContain(res.status); });
    });

    it('cannot record water reading for Society A flat', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/water/readings')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          flatId: flatAId,
          readingDate: new Date().toISOString().split('T')[0],
          openingReading: 100,
          closingReading: 120,
        })
        .expect((res) => { expect([403, 404]).toContain(res.status); });
    });
  });

  // ─── List endpoints must not leak cross-tenant data ───────────────────────

  describe('List endpoints do not leak cross-tenant data', () => {
    it('Society A buildings list does not contain Society B buildings', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/buildings')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const ids: string[] = res.body.data.map((b: { id: string }) => b.id);
      expect(ids).not.toContain(buildingBId);
    });

    it('Society A flats list does not contain Society B flats', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/flats')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const ids: string[] = (res.body.data ?? []).map((f: { id: string }) => f.id);
      expect(ids).not.toContain(flatBId);
    });

    it('Society A announcements list does not contain Society B announcements', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/announcements')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const ids: string[] = (res.body.data ?? []).map((a: { id: string }) => a.id);
      expect(ids).not.toContain(announcementBId);
    });

    it('Society A billing periods list does not contain Society B periods', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/billing/periods')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const ids: string[] = (res.body.data ?? []).map((p: { id: string }) => p.id);
      expect(ids).not.toContain(billingPeriodBId);
    });

    it('Society B buildings list does not contain Society A buildings', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/buildings')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      const ids: string[] = res.body.data.map((b: { id: string }) => b.id);
      expect(ids).not.toContain(buildingAId);
    });

    it('Society B flats list does not contain Society A flats', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/flats')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      const ids: string[] = (res.body.data ?? []).map((f: { id: string }) => f.id);
      expect(ids).not.toContain(flatAId);
    });
  });

  // ─── Cross-tenant mutations rejected ──────────────────────────────────────

  describe('Cross-tenant mutations are rejected', () => {
    it('Society A cannot update a Society B flat', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/flats/${flatBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ unitNumber: 'HACKED' })
        .expect((res) => { expect([403, 404]).toContain(res.status); });
    });

    it('Society A cannot create a building under Society B buildingId', async () => {
      // Attempt to create a flat using a buildingId belonging to Society B
      await request(app.getHttpServer())
        .post('/api/v1/flats')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ buildingId: buildingBId, unitNumber: '999', flatCode: 'TB-999' })
        .expect((res) => { expect([403, 404]).toContain(res.status); });
    });

    it('Society B cannot update a Society A billing period', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/billing/periods/${billingPeriodAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ notes: 'HACKED' })
        .expect((res) => { expect([403, 404, 405]).toContain(res.status); });
    });
  });
});
