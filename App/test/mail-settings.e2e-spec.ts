/**
 * The mail login managed from the platform console, on a REAL Postgres: the
 * migration, the encrypted password column, the endpoints, and the guard.
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
import { MailService } from '../src/mail/mail.service';

jest.setTimeout(60_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const PHONE = '93' + String(UNIQUE).slice(-8);
const email = (label: string) => `${label}-${UNIQUE}@test.example`;

describe('Platform: mail settings (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: MailService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  let platformToken: string;
  let residentToken: string;

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
    mail = moduleFixture.get(MailService);

    await prisma.platformMailSettings.deleteMany();
    const hash = await argon2.hash(PASSWORD);
    await prisma.user.create({ data: { email: email('platform'), firstName: 'Plat', lastName: 'Form', passwordHash: hash, isActive: true, emailVerified: true, isPlatformAdmin: true } });
    const login = async (identifier: string) =>
      (await http().post('/api/v1/auth/login').send({ identifier, password: PASSWORD }).expect(200)).body.data.accessToken as string;
    platformToken = await login(email('platform'));
    // Someone who can sign in but is not a platform admin: a society's own admin.
    residentToken = (
      await http()
        .post('/api/v1/auth/register-society')
        .send({
          society: { name: `E2E Mail ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: email('soc'), contactPhone: PHONE },
          admin: { firstName: 'Admin', lastName: 'Mail', email: email('plain'), phone: PHONE, password: PASSWORD },
        })
        .expect(201)
    ).body.data.accessToken as string;
  });

  afterAll(async () => {
    await prisma.platformMailSettings.deleteMany();
    await app.close();
  });

  const save = (body: Record<string, unknown>, token = platformToken) => http().put('/api/v1/platform/mail/settings').set(auth(token)).send(body);

  it('is for platform admins only', async () => {
    await http().get('/api/v1/platform/mail/settings').set(auth(residentToken)).expect(403);
    await save({ host: 'smtp.example.com', port: 465, username: 'a@example.com', password: 'x' }, residentToken).expect(403);
    await http().delete('/api/v1/platform/mail/settings').set(auth(residentToken)).expect(403);
  });

  it('starts with nothing saved', async () => {
    const res = await http().get('/api/v1/platform/mail/settings').set(auth(platformToken)).expect(200);
    expect(res.body.data).toMatchObject({ host: null, hasPassword: false });
    expect(['environment', 'none']).toContain(res.body.data.source);
  });

  it('saves a login, encrypts the password in the table, and never returns it', async () => {
    const res = await save({ host: 'smtp.novagade.com', port: 465, username: 'billing@novagade.com', password: 'E2E-SECRET-PW', fromName: 'NovaGade' }).expect(200);
    expect(res.body.data).toMatchObject({ source: 'console', host: 'smtp.novagade.com', port: 465, hasPassword: true, passwordUnreadable: false });
    expect(JSON.stringify(res.body)).not.toContain('E2E-SECRET-PW');

    const row = await prisma.platformMailSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
    expect(row.passwordEnc).toBeTruthy();
    expect(row.passwordEnc).not.toContain('E2E-SECRET-PW');
  });

  it('the mail service picks the saved login up at once, with no restart', async () => {
    const setup = await mail.describe();
    expect(setup).toMatchObject({ source: 'console', host: 'smtp.novagade.com', port: 465, from: '"NovaGade" <billing@novagade.com>' });
  });

  it('keeps the password when it is left blank on a later save', async () => {
    const before = (await prisma.platformMailSettings.findUniqueOrThrow({ where: { id: 'singleton' } })).passwordEnc;
    await save({ host: 'smtp.novagade.com', port: 587, username: 'billing@novagade.com', password: '' }).expect(200);
    const after = await prisma.platformMailSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
    expect(after.passwordEnc).toBe(before);
    expect(after.port).toBe(587);
  });

  it('rejects bad input', async () => {
    await save({ host: 'https://smtp.example.com', port: 465, username: 'a@example.com', password: 'x' }).expect(400);
    await save({ host: 'smtp.example.com', port: 70000, username: 'a@example.com', password: 'x' }).expect(400);
    await save({ host: 'smtp.example.com', port: 465, username: 'a@example.com', password: 'x', fromAddress: 'nope' }).expect(400);
  });

  it('leaves an audit entry that has the host but not the password', async () => {
    const rows = await prisma.auditLog.findMany({ where: { entityType: 'PlatformMailSettings' }, orderBy: { createdAt: 'desc' }, take: 5 });
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).toContain('smtp.novagade.com');
    expect(JSON.stringify(rows)).not.toContain('E2E-SECRET-PW');
  });

  it('forgets the saved login on request and falls back to the environment', async () => {
    const res = await http().delete('/api/v1/platform/mail/settings').set(auth(platformToken)).expect(200);
    expect(res.body.data.source).not.toBe('console');
    expect(await prisma.platformMailSettings.count()).toBe(0);
    expect((await mail.describe()).source).not.toBe('console');
  });
});
