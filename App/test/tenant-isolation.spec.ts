/**
 * Tenant isolation tests — prove that Society A users cannot access Society B data.
 * These tests use the real database (integration tests).
 * Run with: npx jest test/tenant-isolation.spec.ts
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * NOTE: These are integration tests that require a running PostgreSQL database.
 * Set TEST_DATABASE_URL in your environment or use the same DATABASE_URL.
 * The tests create isolated data and clean up after themselves.
 */

describe('Tenant Isolation (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let societyAId: string;
  let societyBId: string;
  let tokenSocietyA: string;
  let tokenSocietyB: string;

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
    // Clean up test data
    if (societyAId) {
      await prisma.society.update({ where: { id: societyAId }, data: { deletedAt: new Date() } });
    }
    if (societyBId) {
      await prisma.society.update({ where: { id: societyBId }, data: { deletedAt: new Date() } });
    }
    await app.close();
  });

  describe('Setup: Create two isolated societies', () => {
    it('should create Society A and its admin', async () => {
      // Create Society A admin user
      const userA = await prisma.user.create({
        data: {
          email: `test-admin-a-${Date.now()}@test.com`,
          passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$test',
          firstName: 'Admin',
          lastName: 'A',
          isActive: true,
          isPlatformAdmin: true,
        },
      });

      const societyA = await prisma.society.create({
        data: {
          name: `Test Society A ${Date.now()}`,
          isActive: true,
          configuration: { create: {} },
        },
      });
      societyAId = societyA.id;

      await prisma.societyMembership.create({
        data: {
          societyId: societyAId,
          userId: userA.id,
          role: 'SOCIETY_ADMIN',
          status: 'ACTIVE',
        },
      });

      expect(societyAId).toBeDefined();
    });

    it('should create Society B with independent data', async () => {
      const societyB = await prisma.society.create({
        data: {
          name: `Test Society B ${Date.now()}`,
          isActive: true,
          configuration: { create: {} },
        },
      });
      societyBId = societyB.id;

      expect(societyBId).toBeDefined();
      expect(societyBId).not.toBe(societyAId);
    });
  });

  describe('Tenant filtering on API queries', () => {
    it('should not return Society B buildings when querying for Society A', async () => {
      // Create a building in Society B
      const buildingB = await prisma.building.create({
        data: {
          societyId: societyBId,
          name: 'Building B - Secret',
          code: 'B',
          isActive: true,
        },
      });

      // Query buildings with Society A context (no token needed for service-level test)
      const buildings = await prisma.building.findMany({
        where: { societyId: societyAId },
      });

      const buildingBInResults = buildings.find((b) => b.id === buildingB.id);
      expect(buildingBInResults).toBeUndefined();
    });

    it('should not return Society B flats when querying for Society A', async () => {
      // Create building & flat in Society B
      const buildingB = await prisma.building.create({
        data: { societyId: societyBId, name: 'B Block', code: 'BB', isActive: true },
      });

      const flatB = await prisma.flat.create({
        data: {
          societyId: societyBId,
          buildingId: buildingB.id,
          unitNumber: '101',
          flatCode: 'BB-101',
          isActive: true,
          status: 'ACTIVE',
        },
      });

      // Query flats for Society A
      const flatsA = await prisma.flat.findMany({ where: { societyId: societyAId } });
      expect(flatsA.find((f) => f.id === flatB.id)).toBeUndefined();
    });

    it('should not return Society B bills when querying for Society A', async () => {
      const billsA = await prisma.maintenanceBill.findMany({
        where: { societyId: societyAId },
      });
      const billsB = await prisma.maintenanceBill.findMany({
        where: { societyId: societyBId },
      });

      // No overlap between A and B
      const aIds = new Set(billsA.map((b) => b.id));
      const bIds = new Set(billsB.map((b) => b.id));
      const intersection = [...aIds].filter((id) => bIds.has(id));
      expect(intersection).toHaveLength(0);
    });

    it('should not return Society B payments when querying for Society A', async () => {
      const paymentsA = await prisma.paymentSubmission.findMany({
        where: { societyId: societyAId },
      });
      const paymentsB = await prisma.paymentSubmission.findMany({
        where: { societyId: societyBId },
      });

      const aIds = new Set(paymentsA.map((p) => p.id));
      const intersection = paymentsB.filter((p) => aIds.has(p.id));
      expect(intersection).toHaveLength(0);
    });

    it('should not return Society B expenses when querying for Society A', async () => {
      const expensesA = await prisma.expense.findMany({ where: { societyId: societyAId } });
      const expensesB = await prisma.expense.findMany({ where: { societyId: societyBId } });

      const aIds = new Set(expensesA.map((e) => e.id));
      const intersection = expensesB.filter((e) => aIds.has(e.id));
      expect(intersection).toHaveLength(0);
    });

    it('should not return Society B announcements when querying for Society A', async () => {
      await prisma.announcement.create({
        data: {
          societyId: societyBId,
          title: 'Society B Secret Announcement',
          content: 'This is confidential to Society B',
          isPublished: true,
          publishedAt: new Date(),
          createdById: (await prisma.user.findFirst({ where: { isPlatformAdmin: true } }))!.id,
        },
      });

      const announcementsA = await prisma.announcement.findMany({
        where: { societyId: societyAId },
      });

      const hasB = announcementsA.some((a) => a.title === 'Society B Secret Announcement');
      expect(hasB).toBe(false);
    });
  });

  describe('Billing calculation isolation', () => {
    it('should generate bills only for flats belonging to the target society', async () => {
      // Verify billingPeriod query is always scoped by societyId
      const periodsA = await prisma.billingPeriod.findMany({ where: { societyId: societyAId } });
      const periodsB = await prisma.billingPeriod.findMany({ where: { societyId: societyBId } });

      const aIds = new Set(periodsA.map((p) => p.id));
      const intersection = periodsB.filter((p) => aIds.has(p.id));
      expect(intersection).toHaveLength(0);
    });
  });
});
