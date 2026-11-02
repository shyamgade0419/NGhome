/**
 * Registering a society with an account that already exists — on a REAL Postgres.
 *
 * A person with an account (a resident of one society, the admin of another) can register a new society with the same
 * email, proving it with that account's own password, and becomes that society's admin. What a fake cannot prove: a wrong
 * password creates nothing and does not reveal anything about the account, the account keeps its own name and phone, a
 * login then offers both societies, each session reaches only its own society, and a platform account or a deactivated
 * one is refused.
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

jest.setTimeout(120_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const RUN = String(Math.floor(10000 + Math.random() * 89999));
const phoneOf = (n: number) => '93' + RUN + String(n).padStart(3, '0');
const email = (label: string) => `${label}-${UNIQUE}@test.example`.toLowerCase();
const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));

describe('Registering a society with an account that already exists (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http_ = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const body = (name: string, adminEmail: string, password: string, n: number) => ({
    society: { name: `E2E Reg ${name} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: email(`soc-${name}`), contactPhone: phoneOf(n) },
    admin: { firstName: 'Typed', lastName: 'OnForm', email: adminEmail, phone: phoneOf(n + 50), password },
  });
  const register = (name: string, adminEmail: string, password: string, n: number) => http_().post('/api/v1/auth/register-society').send(body(name, adminEmail, password, n));
  const login = (adminEmail: string, password = PASSWORD) => http_().post('/api/v1/auth/login').send({ identifier: adminEmail, password });
  const societiesNamed = (name: string) => prisma.society.count({ where: { name: `E2E Reg ${name} ${UNIQUE}` } });

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
  });

  afterAll(async () => {
    await prisma.society.updateMany({ where: { name: { contains: `E2E Reg` }, AND: { name: { contains: String(UNIQUE) } } }, data: { deletedAt: new Date() } });
    await app.close();
  });

  it('refuses a new account on an email that is already taken, as before, when the password is wrong', async () => {
    const first = await register('One', email('owner'), PASSWORD, 1).expect(201);
    expect(first.body.data.memberships).toHaveLength(1);
    const wrong = await register('Two', email('owner'), 'WrongPass999!', 2).expect(409);
    expect(messageOf(wrong.body)).toMatch(/already exists/);
    expect(messageOf(wrong.body)).toMatch(/password you already use/);
    expect(await societiesNamed('Two')).toBe(0); // nothing was created
  });

  it('lets the owner of the account register another society, and keeps the account as it was', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { email: email('owner') } });
    const res = (await register('Three', email('owner'), PASSWORD, 3).expect(201)).body.data;
    expect(res.user.id).toBe(before.id);
    expect(res.memberships).toHaveLength(1);
    expect(res.memberships[0]).toMatchObject({ role: 'SOCIETY_ADMIN', societyName: `E2E Reg Three ${UNIQUE}` });
    expect(res.accessToken).toEqual(expect.any(String));

    const after = await prisma.user.findUniqueOrThrow({ where: { email: email('owner') } });
    // Name, phone and password are the account's own, not what was typed on the form.
    expect(after).toMatchObject({ id: before.id, firstName: before.firstName, lastName: before.lastName, phone: before.phone, passwordHash: before.passwordHash });
    expect(await prisma.user.count({ where: { email: email('owner') } })).toBe(1);

    const society = await prisma.society.findFirstOrThrow({ where: { name: `E2E Reg Three ${UNIQUE}` } });
    expect(society.joinCode).toBeTruthy();
    const audit = await prisma.auditLog.findFirst({ where: { societyId: society.id, entityType: 'Society' } });
    expect(audit?.actorId).toBe(before.id);
    expect(JSON.stringify(audit?.newValues)).toContain('existingAccount');
  });

  it('then offers both societies at sign-in, and each session reaches only its own society', async () => {
    const res = (await login(email('owner')).expect(200)).body.data;
    expect(res.requiresSocietySelection).toBe(true);
    const admins = res.memberships.filter((m: any) => m.role === 'SOCIETY_ADMIN');
    expect(admins.map((m: any) => m.societyName).sort()).toEqual([`E2E Reg One ${UNIQUE}`, `E2E Reg Three ${UNIQUE}`]);

    const idOf = (name: string) => admins.find((m: any) => m.societyName === `E2E Reg ${name} ${UNIQUE}`).id as string;
    const pick = async (name: string) =>
      (await http_().post('/api/v1/auth/select-society').set(auth(res.accessToken)).send({ membershipId: idOf(name) }).expect(200)).body.data.accessToken as string;
    const oneToken = await pick('One');
    const threeToken = await pick('Three');

    const config = async (t: string) => (await http_().get('/api/v1/societies/my/config').set(auth(t)).expect(200)).body.data;
    const oneId = (await prisma.society.findFirstOrThrow({ where: { name: `E2E Reg One ${UNIQUE}` } })).id;
    const threeId = (await prisma.society.findFirstOrThrow({ where: { name: `E2E Reg Three ${UNIQUE}` } })).id;
    expect((await config(oneToken)).societyId).toBe(oneId);
    expect((await config(threeToken)).societyId).toBe(threeId);
  });

  it('lets a resident of one society register a society of their own', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: email('owner') } });
    const societyId = (await prisma.society.findFirstOrThrow({ where: { name: `E2E Reg One ${UNIQUE}` } })).id;
    const resident = await prisma.user.create({
      data: { email: email('resident'), firstName: 'Res', lastName: 'Ident', phone: phoneOf(9), passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: resident.id, role: 'RESIDENT', status: 'ACTIVE', isPrimary: true } });
    expect(owner.id).not.toBe(resident.id);

    const res = (await register('Four', email('resident'), PASSWORD, 4).expect(201)).body.data;
    expect(res.user.id).toBe(resident.id);
    // Still a resident of the first society, now also the admin of the second.
    const roles = await prisma.societyMembership.findMany({ where: { userId: resident.id }, include: { society: true } });
    expect(roles.map((m) => `${m.society.name}:${m.role}`).sort()).toEqual([`E2E Reg Four ${UNIQUE}:SOCIETY_ADMIN`, `E2E Reg One ${UNIQUE}:RESIDENT`]);
  });

  it('refuses a platform administrator account, and a deactivated one', async () => {
    await prisma.user.create({
      data: { email: email('platform'), firstName: 'Plat', lastName: 'Form', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true, isPlatformAdmin: true },
    });
    expect(messageOf((await register('Five', email('platform'), PASSWORD, 5).expect(409)).body)).toMatch(/platform administrator/);
    expect(await societiesNamed('Five')).toBe(0);

    await prisma.user.create({
      data: { email: email('gone'), firstName: 'Gone', lastName: 'User', passwordHash: await argon2.hash(PASSWORD), isActive: false, emailVerified: true },
    });
    expect(messageOf((await register('Six', email('gone'), PASSWORD, 6).expect(409)).body)).toMatch(/already exists/);
    expect(await societiesNamed('Six')).toBe(0);
  });

  it('is case-insensitive about the email, like sign-in', async () => {
    const res = await register('Seven', email('owner').toUpperCase(), PASSWORD, 7).expect(201);
    expect(res.body.data.user.email).toBe(email('owner'));
  });
});
