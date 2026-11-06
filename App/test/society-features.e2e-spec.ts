/**
 * The parts of the app a society switches off — on a REAL Postgres.
 *
 * What a fake cannot prove: every feature is on for a new society, the admin can switch some off and the rest stay on,
 * a change names only what it changes, other settings in the same configuration survive it, any member (a resident
 * included) can read what is off so the apps can hide it, only an admin can change it, and one society's choices never
 * reach another's.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FEATURE_KEYS } from '../src/societies/features';

jest.setTimeout(120_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const RUN = String(Math.floor(10000 + Math.random() * 89999));
const phoneOf = (n: number) => '92' + RUN + String(n).padStart(3, '0');
const email = (label: string) => `${label}-${UNIQUE}@test.example`.toLowerCase();
const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));

describe('Society features (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http_ = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  interface Soc { id: string; admin: string; resident: string }
  let A: Soc;
  let B: Soc;

  async function registerSociety(label: string, n: number): Promise<Soc> {
    const ph = '91' + RUN + String(n).padStart(3, '0');
    const reg = await http_().post('/api/v1/auth/register-society').send({
      society: { name: `E2E Feat ${label} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: email(`soc-${label}`), contactPhone: ph },
      admin: { firstName: label, lastName: 'Admin', email: email(`admin-${label}`), phone: ph, password: PASSWORD },
    }).expect(201);
    const id = reg.body.data.memberships[0].societyId as string;
    const user = await prisma.user.create({ data: { email: email(`res-${label}`), firstName: label, lastName: 'Res', phone: phoneOf(n), passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true } });
    await prisma.societyMembership.create({ data: { societyId: id, userId: user.id, role: 'RESIDENT', status: 'ACTIVE', isPrimary: true } });
    const resident = (await http_().post('/api/v1/auth/login').send({ identifier: email(`res-${label}`), password: PASSWORD }).expect(200)).body.data.accessToken as string;
    return { id, admin: reg.body.data.accessToken as string, resident };
  }

  const features = (t: string) => http_().get('/api/v1/societies/my/features').set(auth(t));
  const change = (t: string, body: Record<string, unknown>) => http_().patch('/api/v1/societies/my/config').set(auth(t)).send(body);

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
    A = await registerSociety('Alpha', 1);
    B = await registerSociety('Bravo', 2);
  });

  afterAll(async () => {
    await prisma.society.updateMany({ where: { name: { contains: `E2E Feat` }, AND: { name: { contains: String(UNIQUE) } } }, data: { deletedAt: new Date() } });
    await app.close();
  });

  it('has every feature on for a new society, for the admin and for a resident', async () => {
    for (const t of [A.admin, A.resident]) {
      const res = (await features(t).expect(200)).body.data.features;
      expect(Object.keys(res).sort()).toEqual([...FEATURE_KEYS].sort());
      expect(Object.values(res).every((v) => v === true)).toBe(true);
    }
  });

  it('lets the admin switch some off, and a resident then sees them off and the rest on', async () => {
    await change(A.admin, { features: { parking: false, amenities: false } }).expect(200);
    const seen = (await features(A.resident).expect(200)).body.data.features;
    expect(seen).toMatchObject({ parking: false, amenities: false, visitors: true, deliveries: true, householdHelp: true, events: true, meetings: true, forum: true, chat: true, staff: true });
  });

  it('changes only what it names, so a later change keeps the earlier ones', async () => {
    await change(A.admin, { features: { visitors: false } }).expect(200);
    await change(A.admin, { features: { amenities: true } }).expect(200); // back on
    const seen = (await features(A.admin).expect(200)).body.data.features;
    expect(seen).toMatchObject({ parking: false, visitors: false, amenities: true });
  });

  it('leaves the other settings in the same configuration alone, in either direction', async () => {
    await change(A.admin, { upiId: 'alpha@upi', waterBillingEnabled: false }).expect(200);
    await change(A.admin, { features: { events: false } }).expect(200);
    const config = (await http_().get('/api/v1/societies/my/config').set(auth(A.admin)).expect(200)).body.data;
    expect(config.additionalConfig).toMatchObject({ upiId: 'alpha@upi', waterBillingEnabled: false, features: { events: false, parking: false } });
    await change(A.admin, { upiId: 'beta@upi' }).expect(200); // an unrelated change keeps the features
    expect((await features(A.admin).expect(200)).body.data.features).toMatchObject({ events: false, parking: false });
  });

  it('refuses an unknown name or a value that is not true or false, naming the problem, and saves nothing', async () => {
    const before = (await features(A.admin).expect(200)).body.data.features;
    expect(messageOf((await change(A.admin, { features: { parkng: false } }).expect(400)).body)).toMatch(/"parkng" is not a feature/);
    expect(messageOf((await change(A.admin, { features: { parking: 'no' } }).expect(400)).body)).toMatch(/"parking" must be true or false/);
    await change(A.admin, { features: ['parking'] }).expect(400);
    await change(A.admin, { features: 'off' }).expect(400);
    expect((await features(A.admin).expect(200)).body.data.features).toEqual(before);
  });

  it('is the admin\'s to change: a resident cannot', async () => {
    await change(A.resident, { features: { chat: false } }).expect(403);
    expect((await features(A.admin).expect(200)).body.data.features.chat).toBe(true);
  });

  it('keeps one society\'s choices from reaching another', async () => {
    const b = (await features(B.admin).expect(200)).body.data.features;
    expect(Object.values(b).every((v) => v === true)).toBe(true);
    await change(B.admin, { features: { forum: false } }).expect(200);
    expect((await features(A.admin).expect(200)).body.data.features.forum).toBe(true);
    expect((await features(B.resident).expect(200)).body.data.features.forum).toBe(false);
  });

  it('needs a signed-in member to read it', async () => {
    await http_().get('/api/v1/societies/my/features').expect(401);
  });
});
