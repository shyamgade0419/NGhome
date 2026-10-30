/**
 * A water meter that counts down, against a REAL Postgres, through real HTTP.
 *
 * One flat's meter runs backwards (98362 last month, 98336 now: 26 used). The flat is marked, and
 * from then on its readings are entered exactly as the dial shows them. These tests pin that the
 * units come out right everywhere a reading is stored, that the flat's own direction is the only
 * thing that decides it (never a guess from the numbers), and that flats are unaffected.
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
const phone = (n: number) => '91' + String(UNIQUE).slice(-7) + String(n);

describe('Water meter that counts down (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let societyId: string;
  let buildingId: string;
  let resident: string;
  let normalFlat: string;
  let reversedFlat: string;
  let period: string;
  let monthNo = 0;

  const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));
  const newFlat = async (unit: string, extra: Record<string, unknown> = {}) =>
    (await http().post('/api/v1/flats').set(auth(admin)).send({ buildingId, unitNumber: unit, flatCode: `W-${unit}`, ...extra }).expect(201)).body.data as { id: string; waterMeterReversed: boolean };
  const newPeriod = async () => {
    monthNo += 1;
    const mm = String(monthNo).padStart(2, '0');
    return (await http().post('/api/v1/billing/periods').set(auth(admin)).send({
      periodYear: 2041, periodMonth: monthNo, startDate: `2041-${mm}-01`, endDate: `2041-${mm}-28`, dueDate: `2041-${mm}-10`,
    }).expect(201)).body.data.id as string;
  };
  const record = (flatId: string, openingReading: number, closingReading: number) =>
    http().post('/api/v1/water/readings').set(auth(admin)).send({ flatId, readingDate: '2041-01-05', openingReading, closingReading });
  const allocate = (periodId: string, readings: { flatId: string; openingReading: number; closingReading: number }[]) =>
    http().post(`/api/v1/water/periods/${periodId}/allocate`).set(auth(admin)).send({
      readingDate: '2041-01-05', municipalWaterBill: 360, tankerCost: 0, commonElectricityBill: 0, electricityWaterPercent: 0, readings,
    });

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
      society: { name: `E2E Water ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-w-${UNIQUE}@test.example`, contactPhone: phone(1) },
      admin: { firstName: 'Admin', lastName: 'W', email: `admin-w-${UNIQUE}@test.example`, phone: phone(1), password: PASSWORD },
    }).expect(201);
    admin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    buildingId = (await http().post('/api/v1/buildings').set(auth(admin)).send({ name: 'W', code: 'W' }).expect(201)).body.data.id;
    normalFlat = (await newFlat('101')).id;
    reversedFlat = (await newFlat('102')).id;

    const email = `wres-${UNIQUE}@test.example`;
    const user = await prisma.user.create({ data: { email, firstName: 'Res', lastName: 'W', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true } });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId: normalFlat, role: SystemRole.RESIDENT, status: 'ACTIVE', isPrimary: true } });
    resident = (await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200)).body.data.accessToken;

    await http().patch(`/api/v1/flats/${reversedFlat}`).set(auth(admin)).send({ waterMeterReversed: true }).expect(200);
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
  });

  describe('marking a flat', () => {
    it('is off by default, so every existing flat reads forward', async () => {
      expect((await newFlat('201')).waterMeterReversed).toBe(false);
    });

    it('can be set when the flat is made, and changed later by the admin', async () => {
      const f = await newFlat('202', { waterMeterReversed: true });
      expect(f.waterMeterReversed).toBe(true);
      const back = await http().patch(`/api/v1/flats/${f.id}`).set(auth(admin)).send({ waterMeterReversed: false }).expect(200);
      expect(back.body.data.waterMeterReversed).toBe(false);
    });

    it('is the admin\'s to change, not a resident\'s', async () => {
      await http().patch(`/api/v1/flats/${normalFlat}`).set(auth(resident)).send({ waterMeterReversed: true }).expect(403);
      expect((await prisma.flat.findUniqueOrThrow({ where: { id: normalFlat } })).waterMeterReversed).toBe(false);
    });

    it('refuses something that is not true or false', async () => {
      await http().patch(`/api/v1/flats/${normalFlat}`).set(auth(admin)).send({ waterMeterReversed: 'sometimes' }).expect(400);
    });
  });

  describe('a single reading', () => {
    it('counts 98362 then 98336 as 26 units on the flat whose meter counts down', async () => {
      const res = await record(reversedFlat, 98362, 98336).expect(201);
      expect(Number(res.body.data.consumption)).toBe(26);
      expect(Number(res.body.data.openingReading)).toBe(98362); // kept as the dial showed it
      expect(Number(res.body.data.closingReading)).toBe(98336);
    });

    it('refuses the same flat\'s reading going the other way, and says its meter counts down', async () => {
      const res = await record(reversedFlat, 98336, 98362).expect(400);
      expect(messageOf(res.body)).toMatch(/counts down/);
    });

    it('allows no change on a reversed meter (nothing used)', async () => {
      const res = await record(reversedFlat, 500, 500).expect(201);
      expect(Number(res.body.data.consumption)).toBe(0);
    });

    it('leaves an ordinary flat exactly as before: counts up, and a lower closing is refused', async () => {
      const ok = await record(normalFlat, 100, 126).expect(201);
      expect(Number(ok.body.data.consumption)).toBe(26);
      const bad = await record(normalFlat, 98362, 98336).expect(400);
      expect(messageOf(bad.body)).toMatch(/mark it that way/); // points at the fix
    });
  });

  describe('the monthly allocation', () => {
    it('shares the cost by units used, counting the reversed flat\'s 26 and the other\'s 10', async () => {
      const id = await newPeriod();
      const res = await allocate(id, [
        { flatId: normalFlat, openingReading: 100, closingReading: 110 },
        { flatId: reversedFlat, openingReading: 98362, closingReading: 98336 },
      ]).expect(201);
      const body = res.body.data;
      expect(body.totalUnits).toBe(36);
      expect(body.ratePerUnit).toBe(10); // 360 / 36
      const by = (flatId: string) => body.flatReadings.find((r: any) => r.flatId === flatId);
      expect(by(reversedFlat)).toMatchObject({ consumption: 26, charge: 260 });
      expect(by(normalFlat)).toMatchObject({ consumption: 10, charge: 100 });

      const stored = await prisma.waterMeterReading.findMany({ where: { societyId, billingPeriodId: id } });
      const rev = stored.find((r) => r.flatId === reversedFlat)!;
      expect(rev.consumption.toNumber()).toBe(26);
      expect(rev.calculatedAmount!.toNumber()).toBe(260);
      expect(rev.openingReading.toNumber()).toBe(98362);
    });

    it('shows the right units in the period summary', async () => {
      const id = await newPeriod();
      await allocate(id, [{ flatId: reversedFlat, openingReading: 98362, closingReading: 98336 }]).expect(201);
      const s = (await http().get(`/api/v1/water/periods/${id}/summary`).set(auth(admin)).expect(200)).body.data;
      expect(s.totalUnits).toBe(26);
      expect(s.readings[0].consumption).toBe(26);
    });

    it('refuses a reversed flat entered the forward way, naming the flat, and stores nothing', async () => {
      const id = await newPeriod();
      const res = await allocate(id, [
        { flatId: normalFlat, openingReading: 100, closingReading: 110 },
        { flatId: reversedFlat, openingReading: 98336, closingReading: 98362 },
      ]).expect(400);
      expect(messageOf(res.body)).toMatch(/W-102.*counts down/);
      expect(await prisma.waterMeterReading.count({ where: { societyId, billingPeriodId: id } })).toBe(0);
    });

    it('refuses a normal flat entered backwards, and names it', async () => {
      const id = await newPeriod();
      const res = await allocate(id, [{ flatId: normalFlat, openingReading: 110, closingReading: 100 }]).expect(400);
      expect(messageOf(res.body)).toMatch(/W-101/);
    });

    it('follows the flat\'s setting at the moment of entry — fixing the meter and unmarking the flat returns to counting up', async () => {
      const fixed = (await newFlat('301', { waterMeterReversed: true })).id;
      await http().patch(`/api/v1/flats/${fixed}`).set(auth(admin)).send({ waterMeterReversed: false }).expect(200);
      const id = await newPeriod();
      const res = await allocate(id, [{ flatId: fixed, openingReading: 10, closingReading: 14 }]).expect(201);
      expect(res.body.data.flatReadings[0].consumption).toBe(4);
    });
  });
});
