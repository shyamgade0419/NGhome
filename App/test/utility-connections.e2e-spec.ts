/**
 * A flat's electricity connection and the monthly reminder, end to end on a real database. Covers saving one (from the list of
 * companies or a company of one's own), keeping it private to the flat, and the reminder: once a month, on its day, to every
 * resident of that flat only, with the consumer number masked.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ResidencyType, SystemRole } from '@prisma/client';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationSchedulerService } from '../src/notifications/notification-scheduler.service';

jest.setTimeout(120_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const RUN = String(Math.floor(10000 + Math.random() * 89999));
const phone = (n: number) => '7' + RUN + String(n).padStart(4, '0');
const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));
/** An India time as a UTC instant. */
const ist = (iso: string) => new Date(new Date(`${iso}Z`).getTime() - 5.5 * 3_600_000);

describe('Electricity connections and the monthly reminder (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let scheduler: NotificationSchedulerService;
  const http_ = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let societyId: string;
  let buildingId: string;
  let personNo = 0;
  let flatNo = 0;

  async function newFlat() {
    flatNo += 1;
    return (await http_().post('/api/v1/flats').set(auth(admin)).send({ buildingId, unitNumber: `${flatNo}`, flatCode: `UT-${flatNo}` }).expect(201)).body.data.id as string;
  }

  async function addPerson(flatId: string | null, role: SystemRole = SystemRole.RESIDENT) {
    personNo += 1;
    const email = `ut${personNo}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: { email, firstName: `Person${personNo}`, lastName: 'Test', phone: phone(personNo), passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId, role, residencyType: ResidencyType.OWNER, status: 'ACTIVE', isPrimary: personNo % 2 === 1 } });
    const token = (await http_().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200)).body.data.accessToken as string;
    return { userId: user.id, token };
  }

  const post = (token: string, body: Record<string, unknown>) => http_().post('/api/v1/utility-connections').set(auth(token)).send(body);
  const inbox = async (userId: string) =>
    (await prisma.notificationRecord.findMany({ where: { userId, notification: { type: 'UTILITY_REMINDER' } }, include: { notification: true } })).map((r) => r.notification);

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
    scheduler = moduleFixture.get(NotificationSchedulerService);

    const reg = await http_().post('/api/v1/auth/register-society').send({
      society: { name: `E2E Utility ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-ut-${UNIQUE}@test.example`, contactPhone: '94' + String(UNIQUE).slice(-7) + '5' },
      admin: { firstName: 'Admin', lastName: 'UT', email: `admin-ut-${UNIQUE}@test.example`, phone: '94' + String(UNIQUE).slice(-7) + '5', password: PASSWORD },
    }).expect(201);
    admin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    buildingId = (await http_().post('/api/v1/buildings').set(auth(admin)).send({ name: 'U', code: 'U' }).expect(201)).body.data.id;
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
  });

  describe('saving a connection', () => {
    let owner: { userId: string; token: string };
    let flatId: string;
    beforeAll(async () => {
      flatId = await newFlat();
      owner = await addPerson(flatId);
    });

    it('offers the list of companies and the default reminder day of the 8th', async () => {
      const res = (await http_().get('/api/v1/utility-connections/providers').set(auth(owner.token)).expect(200)).body.data;
      expect(res.defaultReminderDay).toBe(8);
      expect(res.electricity.map((p: any) => p.code)).toContain('TGSPDCL');
      expect(res.electricity.every((p: any) => p.url.startsWith('https://'))).toBe(true);
    });

    it('saves one from the list, with the company\'s website and a reminder on the 8th by default', async () => {
      const c = (await post(owner.token, { providerCode: 'TGSPDCL', consumerNumber: ' ab 1234 5678 ', nickname: 'Flat meter' }).expect(201)).body.data;
      expect(c).toMatchObject({ providerCode: 'TGSPDCL', consumerNumber: 'AB 1234 5678', nickname: 'Flat meter', reminderDay: 8, remindersOn: true });
      expect(c.providerUrl).toBe('https://tgsouthernpower.org');
      expect(c.nextReminder).toMatch(/^\d{4}-\d{2}-08$/);
      expect((await http_().get('/api/v1/utility-connections').set(auth(owner.token)).expect(200)).body.data).toHaveLength(1);
    });

    it('refuses the same number twice, however it is typed', async () => {
      expect(messageOf((await post(owner.token, { providerCode: 'TGSPDCL', consumerNumber: 'AB12345678' }).expect(201)).body)).toBeDefined(); // a different number: fine
      expect(messageOf((await post(owner.token, { providerCode: 'BESCOM', consumerNumber: 'ab 1234  5678' }).expect(400)).body)).toMatch(/already saved/);
    });

    it('takes a company of one\'s own, with its https website, and refuses anything else', async () => {
      const other = (await post(owner.token, { providerCode: 'OTHER', providerName: 'Small Town Power', providerUrl: 'https://smalltownpower.example/pay', consumerNumber: 'ST-0042' }).expect(201)).body.data;
      expect(other).toMatchObject({ providerCode: 'OTHER', providerName: 'Small Town Power', providerUrl: 'https://smalltownpower.example/pay' });
      expect(messageOf((await post(owner.token, { providerCode: 'OTHER', consumerNumber: 'ST-0043' }).expect(400)).body)).toMatch(/name of your electricity company/);
      await post(owner.token, { providerCode: 'OTHER', providerName: 'X Power', providerUrl: 'http://insecure.example', consumerNumber: 'ST-0044' }).expect(400);
      await post(owner.token, { providerCode: 'OTHER', providerName: 'X Power', providerUrl: 'javascript:alert(1)', consumerNumber: 'ST-0045' }).expect(400);
      await post(owner.token, { providerCode: 'NOPE', consumerNumber: 'ST-0046' }).expect(400);
    });

    it('refuses a reminder day that is not a day every month has, and a number that is not one', async () => {
      await post(owner.token, { providerCode: 'KSEB', consumerNumber: 'KS-0001', reminderDay: 31 }).expect(400);
      await post(owner.token, { providerCode: 'KSEB', consumerNumber: 'KS-0002', reminderDay: 0 }).expect(400);
      await post(owner.token, { providerCode: 'KSEB', consumerNumber: '<b>1</b>' }).expect(400);
      await post(owner.token, { providerCode: 'KSEB', consumerNumber: '12' }).expect(400);
    });

    it('stops at five connections for a flat', async () => {
      const f = await newFlat();
      const p = await addPerson(f);
      for (let i = 0; i < 5; i += 1) await post(p.token, { providerCode: 'BESCOM', consumerNumber: `BE-100${i}` }).expect(201);
      expect(messageOf((await post(p.token, { providerCode: 'BESCOM', consumerNumber: 'BE-1009' }).expect(400)).body)).toMatch(/up to 5/);
    });

    it('changes the reminder day, turns reminders off, and removes a connection', async () => {
      const mine = (await http_().get('/api/v1/utility-connections').set(auth(owner.token)).expect(200)).body.data as any[];
      const id = mine[0].id;
      const changed = (await http_().patch(`/api/v1/utility-connections/${id}`).set(auth(owner.token)).send({ reminderDay: 12, nickname: 'Main' }).expect(200)).body.data;
      expect(changed).toMatchObject({ reminderDay: 12, nickname: 'Main' });
      const off = (await http_().patch(`/api/v1/utility-connections/${id}`).set(auth(owner.token)).send({ remindersOn: false }).expect(200)).body.data;
      expect(off).toMatchObject({ remindersOn: false, nextReminder: null });
      await http_().delete(`/api/v1/utility-connections/${id}`).set(auth(owner.token)).expect(200);
      await http_().patch(`/api/v1/utility-connections/${id}`).set(auth(owner.token)).send({ nickname: 'x' }).expect(404);
    });
  });

  describe('privacy', () => {
    it('keeps a flat\'s connections from every other flat, and from the admin', async () => {
      const f1 = await newFlat();
      const a = await addPerson(f1);
      const mine = (await post(a.token, { providerCode: 'MSEDCL', consumerNumber: 'MS-7777' }).expect(201)).body.data;

      const f2 = await newFlat();
      const b = await addPerson(f2);
      expect((await http_().get('/api/v1/utility-connections').set(auth(b.token)).expect(200)).body.data).toEqual([]);
      await http_().patch(`/api/v1/utility-connections/${mine.id}`).set(auth(b.token)).send({ nickname: 'mine now' }).expect(404);
      await http_().delete(`/api/v1/utility-connections/${mine.id}`).set(auth(b.token)).expect(404);

      // The society admin has no flat here, so there is nothing for them to list.
      await http_().get('/api/v1/utility-connections').set(auth(admin)).expect(403);
      await http_().get('/api/v1/utility-connections').expect(401);
      expect((await prisma.utilityConnection.findUniqueOrThrow({ where: { id: mine.id } })).nickname).toBeNull();
    });
  });

  describe('the monthly reminder', () => {
    let flatId: string;
    let owner: { userId: string; token: string };
    let tenant: { userId: string; token: string };
    let neighbour: { userId: string; token: string };
    let conn: { id: string };

    beforeAll(async () => {
      flatId = await newFlat();
      owner = await addPerson(flatId);
      tenant = await addPerson(flatId);
      neighbour = await addPerson(await newFlat());
      conn = (await post(owner.token, { providerCode: 'TGSPDCL', consumerNumber: '9876 5432 1098', nickname: 'Flat meter' }).expect(201)).body.data;
    });

    it('is not sent before its day, or before 9 in the morning', async () => {
      // The job looks at every society's connections, so what counts is what this flat was sent.
      await scheduler.utilityReminders(ist('2046-03-07T12:00:00'));
      await scheduler.utilityReminders(ist('2046-03-08T08:30:00'));
      expect(await inbox(owner.userId)).toHaveLength(0);
    });

    it('goes to everyone in the flat, and only them, on the 8th, with the number masked', async () => {
      expect(await scheduler.utilityReminders(ist('2046-03-08T09:15:00'))).toBeGreaterThanOrEqual(1);
      for (const u of [owner, tenant]) {
        const got = await inbox(u.userId);
        expect(got).toHaveLength(1);
        expect(got[0]).toMatchObject({ title: 'Time to check your electricity bill', type: 'UTILITY_REMINDER' });
        expect(got[0].body).toContain('Flat meter');
        expect(got[0].body).toContain('•••• 1098');
        expect(got[0].body).not.toContain('9876');
        expect(got[0].data).toMatchObject({ connectionId: conn.id });
      }
      expect(await inbox(neighbour.userId)).toHaveLength(0);
    });

    it('goes once a month, however often it runs, and again the next month', async () => {
      await scheduler.utilityReminders(ist('2046-03-08T18:00:00'));
      await scheduler.utilityReminders(ist('2046-03-09T10:00:00'));
      await Promise.all([scheduler.utilityReminders(ist('2046-03-08T20:00:00')), scheduler.utilityReminders(ist('2046-03-08T20:00:00'))]);
      expect(await inbox(owner.userId)).toHaveLength(1);

      expect(await scheduler.utilityReminders(ist('2046-04-08T09:30:00'))).toBeGreaterThanOrEqual(1);
      expect(await inbox(owner.userId)).toHaveLength(2);
    });

    it('is sent late, within two days, if the server missed the day, and not after that', async () => {
      const f = await newFlat();
      const p = await addPerson(f);
      await post(p.token, { providerCode: 'BESCOM', consumerNumber: 'BE-5555' }).expect(201);
      await scheduler.utilityReminders(ist('2046-06-11T10:00:00')); // three days late: skipped
      expect(await inbox(p.userId)).toHaveLength(0);
      expect(await scheduler.utilityReminders(ist('2046-06-10T10:00:00'))).toBeGreaterThanOrEqual(1); // two days late
      expect(await inbox(p.userId)).toHaveLength(1);
    });

    it('follows the reminder day chosen, and stays quiet when reminders are off', async () => {
      const f = await newFlat();
      const p = await addPerson(f);
      const c = (await post(p.token, { providerCode: 'KSEB', consumerNumber: 'KS-9001', reminderDay: 15 }).expect(201)).body.data;
      await scheduler.utilityReminders(ist('2046-08-08T10:00:00'));
      expect(await inbox(p.userId)).toHaveLength(0);
      await http_().patch(`/api/v1/utility-connections/${c.id}`).set(auth(p.token)).send({ remindersOn: false }).expect(200);
      await scheduler.utilityReminders(ist('2046-08-15T10:00:00'));
      expect(await inbox(p.userId)).toHaveLength(0);
      await http_().patch(`/api/v1/utility-connections/${c.id}`).set(auth(p.token)).send({ remindersOn: true }).expect(200);
      expect(await scheduler.utilityReminders(ist('2046-08-15T10:00:00'))).toBeGreaterThanOrEqual(1);
      expect(await inbox(p.userId)).toHaveLength(1);
    });

    it('runs with the other timed notifications', async () => {
      const f = await newFlat();
      const p = await addPerson(f);
      await post(p.token, { providerCode: 'TNPDCL', consumerNumber: 'TN-3333' }).expect(201);
      const result = await scheduler.run(ist('2046-09-08T10:00:00'));
      expect(result.utilityReminders).toBeGreaterThanOrEqual(1);
      expect(await inbox(p.userId)).toHaveLength(1);
    });
  });
});
