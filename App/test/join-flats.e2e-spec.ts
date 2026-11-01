/**
 * What a resident sees when they enter a join code: the society's name and the flats to choose from —
 * against a REAL Postgres, through real HTTP.
 *
 * A society that has just been registered has no buildings or flats until its admin adds them, so the
 * list is empty; the clients must say so rather than let someone fill in a form that cannot be finished.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const phone = (n: number) => '92' + String(UNIQUE).slice(-7) + String(n);

describe('Join code lookup (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let societyId: string;
  let joinCode: string;

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
      society: { name: `E2E Join ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-j-${UNIQUE}@test.example`, contactPhone: phone(1) },
      admin: { firstName: 'Admin', lastName: 'J', email: `admin-j-${UNIQUE}@test.example`, phone: phone(1), password: PASSWORD },
    }).expect(201);
    admin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    joinCode = (await prisma.society.findUniqueOrThrow({ where: { id: societyId } })).joinCode!;
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
  });

  it('gives a brand-new society an empty flat list, with its name', async () => {
    const res = await http().get(`/api/v1/societies/by-code/${joinCode}`).expect(200);
    expect(res.body.data.name).toBe(`E2E Join ${UNIQUE}`);
    expect(res.body.data.flats).toEqual([]);
  });

  it('lists each flat with its building once the admin has added them', async () => {
    const wingA = (await http().post('/api/v1/buildings').set(auth(admin)).send({ name: 'Wing A', code: 'A' }).expect(201)).body.data.id;
    const wingB = (await http().post('/api/v1/buildings').set(auth(admin)).send({ name: 'Wing B', code: 'B' }).expect(201)).body.data.id;
    await http().post('/api/v1/flats').set(auth(admin)).send({ buildingId: wingA, unitNumber: '101', flatCode: 'A-101' }).expect(201);
    await http().post('/api/v1/flats').set(auth(admin)).send({ buildingId: wingB, unitNumber: '101', flatCode: 'B-101' }).expect(201);

    const res = await http().get(`/api/v1/societies/by-code/${joinCode.toLowerCase()}`).expect(200);
    const flats = res.body.data.flats as { id: string; flatCode: string; buildingName: string; unitNumber: string }[];
    expect(flats.map((f) => `${f.flatCode} / ${f.buildingName}`).sort()).toEqual(['A-101 / Wing A', 'B-101 / Wing B']);
    expect(flats[0].id).toBeTruthy();
  });

  it('lets a resident join the flat they picked', async () => {
    const flat = (await http().get(`/api/v1/societies/by-code/${joinCode}`).expect(200)).body.data.flats[0];
    const res = await http().post('/api/v1/auth/join-society').send({
      joinCode, flatId: flat.id, residencyType: 'OWNER', firstName: 'Ravi', lastName: 'Kumar',
      email: `ravi-${UNIQUE}@test.example`, phone: phone(2), password: PASSWORD,
    }).expect(201);
    expect(res.body.data.user.email).toBe(`ravi-${UNIQUE}@test.example`);
  });

  it('says plainly when the code is wrong', async () => {
    await http().get('/api/v1/societies/by-code/NOPE-0000').expect(404);
  });
});
