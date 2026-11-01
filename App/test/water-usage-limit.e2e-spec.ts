/**
 * The water usage limit — against a REAL Postgres, through real HTTP.
 *
 * Each flat pays the normal rate for its units up to the limit (say 20 KL); the units above it cost more:
 * a percentage more per unit, a fixed rupee amount more per unit, or a one-time fee. A flat within the limit
 * pays exactly what it did before.
 *
 * What a fake cannot prove: that the saved rule carries into the next month, that a bad rule changes
 * nothing, that the bill says how much of the water charge came from the limit, and that the readings and
 * the rule are saved together.
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

jest.setTimeout(90_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const phone = (n: number) => '93' + String(UNIQUE).slice(-7) + String(n);

describe('Water usage limit (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let accountant: string;
  let resident: string;
  let societyId: string;
  let buildingId: string;
  let small: string; // uses 10 KL: within the limit
  let big: string; // uses 30 KL: 10 above it
  let exact: string; // uses exactly 20 KL
  let monthNo = 0;
  const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));

  async function makeUser(label: string, role: SystemRole, flatId: string | null = null): Promise<string> {
    const email = `${label}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: { email, firstName: label, lastName: 'Test', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId, role, status: 'ACTIVE', isPrimary: false } });
    return (await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200)).body.data.accessToken as string;
  }

  const newFlat = async (code: string) =>
    (await http().post('/api/v1/flats').set(auth(admin)).send({ buildingId, unitNumber: code, flatCode: code }).expect(201)).body.data.id as string;

  /** A period per call, in 2046, so each test starts from empty readings. */
  async function newPeriod() {
    monthNo += 1;
    const year = 2046 + Math.floor((monthNo - 1) / 12);
    const m = ((monthNo - 1) % 12) + 1;
    const mm = String(m).padStart(2, '0');
    return (await http().post('/api/v1/billing/periods').set(auth(admin)).send({
      periodYear: year, periodMonth: m, startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-28`, dueDate: `${year}-${mm}-10`,
    }).expect(201)).body.data.id as string;
  }

  /** ₹6,000 of water over 60 KL, so the normal rate is exactly ₹100 a KL. */
  const readings = () => [
    { flatId: small, openingReading: 100, closingReading: 110 },
    { flatId: big, openingReading: 200, closingReading: 230 },
    { flatId: exact, openingReading: 300, closingReading: 320 },
  ];
  const allocate = (periodId: string, extra: Record<string, unknown> = {}, token = admin) =>
    http().post(`/api/v1/water/periods/${periodId}/allocate`).set(auth(token)).send({
      readingDate: '2046-01-05', municipalWaterBill: 6000, tankerCost: 0, commonElectricityBill: 0, electricityWaterPercent: 0,
      readings: readings(), ...extra,
    });
  const chargeOf = (body: any, flatId: string) => body.data.flatReadings.find((f: any) => f.flatId === flatId);
  const savedRule = async () => {
    const cfg = await prisma.waterBillingConfig.findFirstOrThrow({ where: { societyId, billingModel: 'SOCIETY_ALLOCATION' }, orderBy: { createdAt: 'desc' } });
    return (cfg.config as any).usageLimit ?? null;
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

    const reg = await http().post('/api/v1/auth/register-society').send({
      society: { name: `E2E Water ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-w-${UNIQUE}@test.example`, contactPhone: phone(1) },
      admin: { firstName: 'Admin', lastName: 'W', email: `admin-w-${UNIQUE}@test.example`, phone: phone(1), password: PASSWORD },
    }).expect(201);
    admin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    buildingId = (await http().post('/api/v1/buildings').set(auth(admin)).send({ name: 'W', code: 'W' }).expect(201)).body.data.id;
    small = await newFlat('W-1');
    big = await newFlat('W-2');
    exact = await newFlat('W-3');
    accountant = await makeUser('wacct', SystemRole.SOCIETY_ACCOUNTANT);
    resident = await makeUser('wres', SystemRole.RESIDENT, small);
    await http().post('/api/v1/billing-rules').set(auth(admin)).send({
      name: 'Maintenance', calculationType: 'EQUAL_PER_FLAT', effectiveFrom: '2040-01-01T00:00:00.000Z', config: { amount: 1000 },
    }).expect(201);
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
  });

  it('with no limit, every unit is charged at the normal rate', async () => {
    const res = await allocate(await newPeriod()).expect(201);
    expect(res.body.data.ratePerUnit).toBe(100);
    expect(res.body.data.usageLimit).toBeNull();
    expect(chargeOf(res.body, big).charge).toBe(3000);
    expect(chargeOf(res.body, big).excessCharge).toBe(0);
    expect(res.body.data.excessTotal).toBe(0);
  });

  it('charges a percentage more for the units above the limit, and the normal rate for the rest', async () => {
    const res = await allocate(await newPeriod(), { usageLimit: { limitUnits: 20, mode: 'PERCENT', value: 25 } }).expect(201);
    expect(res.body.data.ratePerUnit).toBe(100); // the normal rate does not move
    // within the limit: exactly what it was
    expect(chargeOf(res.body, small).charge).toBe(1000);
    expect(chargeOf(res.body, exact).charge).toBe(2000);
    expect(chargeOf(res.body, exact).excessUnits).toBe(0);
    // 30 KL: 20 at ₹100 and 10 at ₹125
    const b = chargeOf(res.body, big);
    expect(b.baseCharge).toBe(3000);
    expect(b.excessUnits).toBe(10);
    expect(b.excessCharge).toBe(250);
    expect(b.charge).toBe(3250);
    expect(res.body.data.excessTotal).toBe(250);
    expect(res.body.data.usageLimitText).toContain('25% more');
  });

  it('adds a fixed rupee amount per unit above the limit', async () => {
    const res = await allocate(await newPeriod(), { usageLimit: { limitUnits: 20, mode: 'PER_UNIT', value: 20 } }).expect(201);
    expect(chargeOf(res.body, big).charge).toBe(3200); // 3000 + 10 × 20
    expect(chargeOf(res.body, small).charge).toBe(1000);
  });

  it('adds a one-time fee once the limit is crossed, and not before', async () => {
    const res = await allocate(await newPeriod(), { usageLimit: { limitUnits: 20, mode: 'ONE_TIME', value: 500 } }).expect(201);
    expect(chargeOf(res.body, big).charge).toBe(3500);
    expect(chargeOf(res.body, exact).charge).toBe(2000); // exactly on the limit: not crossed
  });

  it('saves the limit with the water rules, so the next month uses it without being told', async () => {
    await allocate(await newPeriod(), { usageLimit: { limitUnits: 20, mode: 'PERCENT', value: 10 } }).expect(201);
    expect(await savedRule()).toEqual({ limitUnits: 20, mode: 'PERCENT', value: 10 });

    const next = await allocate(await newPeriod()).expect(201); // no usageLimit in the body
    expect(next.body.data.usageLimit).toEqual({ limitUnits: 20, mode: 'PERCENT', value: 10 });
    expect(chargeOf(next.body, big).charge).toBe(3100); // 3000 + 10 × 10

    // and it shows in the rules the screens read
    const configs = (await http().get('/api/v1/water/configs').set(auth(admin)).expect(200)).body.data;
    const cfg = configs.find((c: any) => c.billingModel === 'SOCIETY_ALLOCATION');
    expect(cfg.config.usageLimit.limitUnits).toBe(20);
  });

  it('can be switched off, and stays off', async () => {
    const off = await allocate(await newPeriod(), { usageLimit: null }).expect(201);
    expect(off.body.data.usageLimit).toBeNull();
    expect(chargeOf(off.body, big).charge).toBe(3000);
    expect(await savedRule()).toBeNull();
    const after = await allocate(await newPeriod()).expect(201);
    expect(chargeOf(after.body, big).charge).toBe(3000);
  });

  it('refuses a bad rule and changes nothing', async () => {
    await allocate(await newPeriod(), { usageLimit: { limitUnits: 20, mode: 'PERCENT', value: 25 } }).expect(201);
    const before = await savedRule();
    const period = await newPeriod();
    const bad = [
      { limitUnits: 0, mode: 'PERCENT', value: 25 },
      { limitUnits: -5, mode: 'PERCENT', value: 25 },
      { limitUnits: 20, mode: 'PERCENT', value: -1 },
      { limitUnits: 20, mode: 'PERCENT', value: 5000 },
      { limitUnits: 20, mode: 'DOUBLE', value: 25 },
      { limitUnits: 20, mode: 'PER_UNIT', value: 1.234 },
      { limitUnits: 20, mode: 'PERCENT' },
    ];
    for (const usageLimit of bad) {
      const res = await allocate(period, { usageLimit }).expect(400);
      expect(messageOf(res.body)).toBeTruthy();
    }
    expect(await savedRule()).toEqual(before);
    expect(await prisma.waterMeterReading.count({ where: { societyId, billingPeriodId: period } })).toBe(0);
  });

  it('records the units above the limit and their cost on each reading', async () => {
    const period = await newPeriod();
    await allocate(period, { usageLimit: { limitUnits: 20, mode: 'PERCENT', value: 25 } }).expect(201);
    const rows = await prisma.waterMeterReading.findMany({ where: { societyId, billingPeriodId: period } });
    const row = (flatId: string) => rows.find((r) => r.flatId === flatId)!;
    expect(row(big).calculatedAmount!.toFixed(2)).toBe('3250.00');
    expect(row(big).excessUnits!.toFixed(3)).toBe('10.000');
    expect(row(big).excessCharge!.toFixed(2)).toBe('250.00');
    expect(row(small).excessUnits!.toFixed(3)).toBe('0.000'); // the rule applied; the flat stayed within it
    expect(row(small).excessCharge!.toFixed(2)).toBe('0.00');

    // with no limit, the columns are left empty
    const plain = await newPeriod();
    await allocate(plain, { usageLimit: null }).expect(201);
    const none = await prisma.waterMeterReading.findMany({ where: { societyId, billingPeriodId: plain } });
    expect(none.every((r) => r.excessUnits === null && r.excessCharge === null)).toBe(true);
  });

  it('puts the charge on the bill and says how much of it came from the limit', async () => {
    const period = await newPeriod();
    await allocate(period, { usageLimit: { limitUnits: 20, mode: 'PERCENT', value: 25 } }).expect(201);
    await http().post(`/api/v1/billing/periods/${period}/generate`).set(auth(admin)).expect(201);

    const bill = await prisma.maintenanceBill.findFirstOrThrow({ where: { billingPeriodId: period, flatId: big }, include: { lineItems: true } });
    expect(bill.waterCharges.toFixed(2)).toBe('3250.00');
    expect(bill.totalAmount.toFixed(2)).toBe('4250.00'); // 1000 maintenance + 3250 water
    const water = bill.lineItems.find((l) => l.componentType === 'WATER')!;
    expect(water.calculationNote).toContain('including ₹250.00 for 10 KL above the usage limit');

    const within = await prisma.maintenanceBill.findFirstOrThrow({ where: { billingPeriodId: period, flatId: small }, include: { lineItems: true } });
    expect(within.lineItems.find((l) => l.componentType === 'WATER')!.calculationNote).not.toContain('usage limit');
  });

  it('shows the extra in the period summary', async () => {
    const period = await newPeriod();
    await allocate(period, { usageLimit: { limitUnits: 20, mode: 'PERCENT', value: 25 } }).expect(201);
    const sum = (await http().get(`/api/v1/water/periods/${period}/summary`).set(auth(admin)).expect(200)).body.data;
    expect(sum.totalCharge).toBe(6250);
    expect(sum.totalExcess).toBe(250);
    expect(sum.ratePerUnit).toBe(100);
    const row = sum.readings.find((r: any) => r.flatId === big);
    expect(row.excessUnits).toBe(10);
    expect(row.excessCharge).toBe(250);
  });

  it('is for the admin and the accountant, not residents', async () => {
    const period = await newPeriod();
    await allocate(period, { usageLimit: { limitUnits: 20, mode: 'PERCENT', value: 25 } }, resident).expect(403);
    await allocate(period, { usageLimit: { limitUnits: 20, mode: 'PERCENT', value: 25 } }, accountant).expect(201);
  });
});
