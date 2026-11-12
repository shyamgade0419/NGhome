/**
 * Who gets told, on a REAL Postgres: a notification sent to one building or to chosen flats reaches only those, an
 * announcement, a meeting or an event tells the right people once, and the clock-driven reminders go out a day before,
 * once, and never to people who were only just told.
 *
 * What a fake cannot prove: the building and flat filters work through real memberships and flats, an id from another
 * society reaches nobody, a repeated run does not send twice, and the person who posted is not alerted about their own post.
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
import { NotificationSchedulerService } from '../src/notifications/notification-scheduler.service';

jest.setTimeout(180_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const RUN = String(Math.floor(10000 + Math.random() * 89999));
const email = (label: string) => `${label}-${UNIQUE}@test.example`.toLowerCase();
const HOUR = 3_600_000;

describe('Notification reach (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let scheduler: NotificationSchedulerService;
  const http_ = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let societyId: string;
  let otherSocietyId: string;
  let flatOfOtherSociety: string;
  let bldA: string;
  let bldB: string;
  let flatA1: string;
  let flatA2: string;
  let flatB1: string;
  const tok: Record<string, string> = {};
  let phoneCounter = 0;

  async function makeUser(label: string, role: 'RESIDENT' | 'COMMITTEE_MEMBER' | 'SOCIETY_STAFF', flatId?: string) {
    phoneCounter += 1;
    const user = await prisma.user.create({
      data: { email: email(label), firstName: label, lastName: 'T', phone: '93' + RUN + String(phoneCounter).padStart(3, '0'), passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId, role, status: 'ACTIVE', isPrimary: true } });
    tok[label] = (await http_().post('/api/v1/auth/login').send({ identifier: email(label), password: PASSWORD }).expect(200)).body.data.accessToken;
    return user;
  }

  async function register(label: string, n: number) {
    const ph = '91' + RUN + String(n).padStart(3, '0');
    const reg = await http_().post('/api/v1/auth/register-society').send({
      society: { name: `E2E Reach ${label} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: email(`soc-${label}`), contactPhone: ph },
      admin: { firstName: label, lastName: 'Admin', email: email(`admin-${label}`), phone: ph, password: PASSWORD },
    }).expect(201);
    return { id: reg.body.data.memberships[0].societyId as string, admin: reg.body.data.accessToken as string };
  }

  const inbox = async (label: string): Promise<Array<{ title: string; body: string; type: string; data?: any }>> => {
    const res = await http_().get('/api/v1/notifications/my?limit=100').set(auth(tok[label])).expect(200);
    const d = res.body.data;
    const rows = (Array.isArray(d) ? d : d.data) as Array<{ notification: { title: string; body: string; type: string } }>;
    return rows.map((r) => r.notification);
  };
  const countOf = async (label: string, type: string) => (await inbox(label)).filter((n) => n.type === type).length;
  const send = (body: Record<string, unknown>) => http_().post('/api/v1/notifications').set(auth(tok.admin)).send({ type: 'GENERAL', title: 'Hello', body: 'Body', ...body });

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

    const A = await register('Alpha', 1);
    const B = await register('Bravo', 2);
    societyId = A.id;
    otherSocietyId = B.id;
    tok.admin = A.admin;

    const a = await prisma.building.create({ data: { societyId, name: 'Tower A' } });
    const b = await prisma.building.create({ data: { societyId, name: 'Tower B' } });
    bldA = a.id;
    bldB = b.id;
    const mkFlat = (buildingId: string, n: string, sid = societyId) => prisma.flat.create({ data: { societyId: sid, buildingId, unitNumber: n, flatCode: n } });
    flatA1 = (await mkFlat(bldA, 'A1')).id;
    flatA2 = (await mkFlat(bldA, 'A2')).id;
    flatB1 = (await mkFlat(bldB, 'B1')).id;
    const otherBuilding = await prisma.building.create({ data: { societyId: otherSocietyId, name: 'Elsewhere' } });
    flatOfOtherSociety = (await mkFlat(otherBuilding.id, 'Z1', otherSocietyId)).id;

    await makeUser('res1', 'RESIDENT', flatA1);
    await makeUser('res2', 'RESIDENT', flatA2);
    await makeUser('res3', 'RESIDENT', flatB1);
    await makeUser('committee', 'COMMITTEE_MEMBER');
    await makeUser('staff', 'SOCIETY_STAFF');
  });

  afterAll(async () => {
    await prisma.society.updateMany({ where: { name: { contains: 'E2E Reach' }, AND: { name: { contains: String(UNIQUE) } } }, data: { deletedAt: new Date() } });
    await app.close();
  });

  describe('choosing who a notification goes to', () => {
    it('reaches only the chosen building', async () => {
      const res = await send({ title: 'Tower A only', audience: 'BUILDING', audienceConfig: { buildingIds: [bldA] } }).expect(201);
      expect(res.body.data.recipientCount).toBe(2);
      const titles = async (l: string) => (await inbox(l)).map((n) => n.title);
      expect(await titles('res1')).toContain('Tower A only');
      expect(await titles('res2')).toContain('Tower A only');
      expect(await titles('res3')).not.toContain('Tower A only');
      expect(await titles('committee')).not.toContain('Tower A only');
      expect(await titles('staff')).not.toContain('Tower A only');
    });

    it('reaches only the chosen flats', async () => {
      const res = await send({ title: 'Flat A2 only', audience: 'SPECIFIC_FLATS', audienceConfig: { flatIds: [flatA2] } }).expect(201);
      expect(res.body.data.recipientCount).toBe(1);
      expect((await inbox('res2')).map((n) => n.title)).toContain('Flat A2 only');
      expect((await inbox('res1')).map((n) => n.title)).not.toContain('Flat A2 only');
    });

    it('reaches several buildings and treats a block like a building', async () => {
      const both = await send({ title: 'Both towers', audience: 'BUILDING', audienceConfig: { buildingIds: [bldA, bldB] } }).expect(201);
      expect(both.body.data.recipientCount).toBe(3);
      const block = await send({ title: 'Block B', audience: 'BLOCK', audienceConfig: { buildingIds: [bldB] } }).expect(201);
      expect(block.body.data.recipientCount).toBe(1);
      expect((await inbox('res3')).map((n) => n.title)).toContain('Block B');
    });

    it('reaches only the committee, or only the staff', async () => {
      expect((await send({ title: 'Committee only', audience: 'COMMITTEE' }).expect(201)).body.data.recipientCount).toBe(1);
      expect((await send({ title: 'Staff only', audience: 'STAFF' }).expect(201)).body.data.recipientCount).toBe(1);
      expect((await inbox('committee')).map((n) => n.title)).toContain('Committee only');
      expect((await inbox('staff')).map((n) => n.title)).toContain('Staff only');
      expect((await inbox('res1')).map((n) => n.title)).not.toContain('Committee only');
    });

    it('still reaches everyone when no audience is given, as before', async () => {
      const res = await send({ title: 'Everyone' }).expect(201);
      expect(res.body.data.recipientCount).toBeGreaterThanOrEqual(6); // 3 residents, committee, staff, the admin
      for (const l of ['res1', 'res2', 'res3', 'committee', 'staff']) expect((await inbox(l)).map((n) => n.title)).toContain('Everyone');
    });

    it('refuses a building or flats audience with nothing chosen, rather than send to nobody', async () => {
      const a = await send({ audience: 'BUILDING', audienceConfig: { buildingIds: [] } }).expect(400);
      expect(JSON.stringify(a.body)).toMatch(/building/i);
      await send({ audience: 'BUILDING' }).expect(400);
      const b = await send({ audience: 'SPECIFIC_FLATS', audienceConfig: {} }).expect(400);
      expect(JSON.stringify(b.body)).toMatch(/flat/i);
    });

    it('reaches nobody from an id that belongs to another society', async () => {
      const res = await send({ title: 'Foreign flat', audience: 'SPECIFIC_FLATS', audienceConfig: { flatIds: [flatOfOtherSociety] } }).expect(201);
      expect(res.body.data.recipientCount).toBe(0);
    });

    it('lets only an admin or staff send', async () => {
      await http_().post('/api/v1/notifications').set(auth(tok.res1)).send({ type: 'GENERAL', title: 'x', body: 'y' }).expect(403);
    });
  });

  describe('announcements', () => {
    const post = (body: Record<string, unknown>) => http_().post('/api/v1/announcements').set(auth(tok.admin)).send({ title: 'Water tank cleaning', content: 'Supply is off 10 to 2.', ...body });

    it('tells everyone but the poster when one goes live, with urgent ones marked', async () => {
      const before = await countOf('res1', 'ANNOUNCEMENT');
      const adminBefore = (await http_().get('/api/v1/notifications/my?limit=100').set(auth(tok.admin)).expect(200)).body.data;
      const created = (await post({ title: 'Lift 2 down', priority: 'URGENT', isPublished: true }).expect(201)).body.data;
      expect(created.id).toBeTruthy();
      expect(await countOf('res1', 'ANNOUNCEMENT')).toBe(before + 1);
      expect((await inbox('res1')).find((n) => n.type === 'ANNOUNCEMENT')!.title).toBe('Urgent: Lift 2 down');
      for (const l of ['res2', 'res3', 'committee', 'staff']) expect(await countOf(l, 'ANNOUNCEMENT')).toBeGreaterThan(0);
      const adminAfter = (await http_().get('/api/v1/notifications/my?limit=100').set(auth(tok.admin)).expect(200)).body.data;
      const rows = (d: any) => (Array.isArray(d) ? d : d.data) as Array<{ notification: { type: string } }>;
      expect(rows(adminAfter).filter((r) => r.notification.type === 'ANNOUNCEMENT').length).toBe(rows(adminBefore).filter((r) => r.notification.type === 'ANNOUNCEMENT').length);
    });

    it('says nothing for a draft, then tells people once when it is published, however often that is asked', async () => {
      const before = await countOf('res3', 'ANNOUNCEMENT');
      const draft = (await post({ title: 'Draft notice' }).expect(201)).body.data;
      expect(await countOf('res3', 'ANNOUNCEMENT')).toBe(before);
      await http_().post(`/api/v1/announcements/${draft.id}/publish`).set(auth(tok.admin)).expect(201);
      expect(await countOf('res3', 'ANNOUNCEMENT')).toBe(before + 1);
      await http_().post(`/api/v1/announcements/${draft.id}/publish`).set(auth(tok.admin)).expect(201);
      expect(await countOf('res3', 'ANNOUNCEMENT')).toBe(before + 1);
    });

    it('reaches only the audience it is written for', async () => {
      const a1 = await countOf('res1', 'ANNOUNCEMENT');
      const b1 = await countOf('res3', 'ANNOUNCEMENT');
      await post({ title: 'Tower A parking', isPublished: true, audience: 'BUILDING', audienceConfig: { buildingIds: [bldA] } }).expect(201);
      expect(await countOf('res1', 'ANNOUNCEMENT')).toBe(a1 + 1);
      expect(await countOf('res3', 'ANNOUNCEMENT')).toBe(b1);
    });

    it('refuses a building audience with no building', async () => {
      await post({ isPublished: true, audience: 'BUILDING' }).expect(400);
    });

    it('waits for a scheduled time, then tells people once however often the job runs', async () => {
      const later = new Date(Date.now() + 5 * HOUR);
      const before = await countOf('res2', 'ANNOUNCEMENT');
      await post({ title: 'Scheduled notice', isPublished: true, publishAt: later.toISOString() }).expect(201);
      expect(await countOf('res2', 'ANNOUNCEMENT')).toBe(before); // not yet

      await scheduler.dueAnnouncements(new Date(Date.now() + HOUR)); // too early
      expect(await countOf('res2', 'ANNOUNCEMENT')).toBe(before);
      expect(await scheduler.dueAnnouncements(new Date(later.getTime() + 60_000))).toBeGreaterThanOrEqual(1);
      expect(await countOf('res2', 'ANNOUNCEMENT')).toBe(before + 1);
      await scheduler.dueAnnouncements(new Date(later.getTime() + 120_000)); // already told
      expect(await countOf('res2', 'ANNOUNCEMENT')).toBe(before + 1);
    });

    it('does not tell people about an announcement that has already expired', async () => {
      const before = await countOf('res1', 'ANNOUNCEMENT');
      await post({ title: 'Old news', isPublished: true, expiresAt: new Date(Date.now() - HOUR).toISOString() }).expect(201);
      expect(await countOf('res1', 'ANNOUNCEMENT')).toBe(before);
    });
  });

  describe('meetings', () => {
    const schedule = (body: Record<string, unknown>) => http_().post('/api/v1/meetings').set(auth(tok.admin)).send({ title: 'AGM', location: 'Clubhouse', agenda: 'Budget', ...body });

    it('tells everyone when and where, but not the person who scheduled it', async () => {
      const when = new Date(Date.now() + 4 * 24 * HOUR);
      const before = await countOf('res1', 'MEETING');
      await schedule({ meetingDate: when.toISOString() }).expect(201);
      expect(await countOf('res1', 'MEETING')).toBe(before + 1);
      const note = (await inbox('res1')).find((n) => n.type === 'MEETING')!;
      expect(note.title).toBe('Meeting: AGM');
      expect(note.body).toContain('Clubhouse');
      expect(note.body).toContain('Budget');
    });

    it('says nothing for a meeting recorded after the fact', async () => {
      const before = await countOf('res1', 'MEETING');
      await schedule({ title: 'Last month', meetingDate: new Date(Date.now() - 3 * 24 * HOUR).toISOString() }).expect(201);
      expect(await countOf('res1', 'MEETING')).toBe(before);
    });

    it('reminds the day before, once, and not for one scheduled only just now', async () => {
      const day = new Date(Date.now() + 23 * HOUR);
      const old = await prisma.meeting.create({ data: { societyId, title: 'Tomorrow meeting', meetingDate: day, createdById: (await prisma.user.findFirstOrThrow({ where: { email: email('admin-Alpha') } })).id, createdAt: new Date(Date.now() - 3 * 24 * HOUR) } });
      const fresh = await prisma.meeting.create({ data: { societyId, title: 'Just added meeting', meetingDate: day, createdById: old.createdById } });
      const before = await countOf('res1', 'MEETING_REMINDER');
      expect(await scheduler.meetingReminders(new Date())).toBeGreaterThanOrEqual(1);
      expect(await countOf('res1', 'MEETING_REMINDER')).toBe(before + 1);
      expect((await inbox('res1')).filter((n) => n.type === 'MEETING_REMINDER').some((n) => n.title === 'Tomorrow: Tomorrow meeting')).toBe(true);
      expect((await inbox('res1')).some((n) => n.title.includes(fresh.title))).toBe(false);
      await scheduler.meetingReminders(new Date()); // never twice
      expect(await countOf('res1', 'MEETING_REMINDER')).toBe(before + 1);
    });

    it('does not remind for a meeting more than a day away or already past', async () => {
      const adminId = (await prisma.user.findFirstOrThrow({ where: { email: email('admin-Alpha') } })).id;
      await prisma.meeting.create({ data: { societyId, title: 'Far off', meetingDate: new Date(Date.now() + 3 * 24 * HOUR), createdById: adminId, createdAt: new Date(Date.now() - 5 * 24 * HOUR) } });
      await prisma.meeting.create({ data: { societyId, title: 'Gone by', meetingDate: new Date(Date.now() - 2 * HOUR), createdById: adminId, createdAt: new Date(Date.now() - 5 * 24 * HOUR) } });
      const before = await countOf('res1', 'MEETING_REMINDER');
      await scheduler.meetingReminders(new Date());
      expect(await countOf('res1', 'MEETING_REMINDER')).toBe(before);
    });
  });

  describe('events', () => {
    const plan = (body: Record<string, unknown>) => http_().post('/api/v1/events').set(auth(tok.admin)).send({ title: 'Diwali get-together', ...body });
    const eventIn = (days: number) => new Date(Date.now() + days * 24 * HOUR).toISOString();

    it('tells everyone about a new event, but nothing for one hidden from residents', async () => {
      const before = await countOf('res1', 'EVENT');
      await plan({ eventDate: eventIn(10), description: 'Snacks and music' }).expect(201);
      expect(await countOf('res1', 'EVENT')).toBe(before + 1);
      await plan({ title: 'Committee dinner', eventDate: eventIn(10), isVisibleToResidents: false }).expect(201);
      expect(await countOf('res1', 'EVENT')).toBe(before + 1);
    });

    it('tells everyone when an event is moved or called off, and stays quiet for other edits', async () => {
      const id = (await plan({ title: 'Cricket match', eventDate: eventIn(12) }).expect(201)).body.data.id as string;
      const patch = (body: Record<string, unknown>) => http_().patch(`/api/v1/events/${id}`).set(auth(tok.admin)).send(body).expect(200);

      const quiet = await countOf('res2', 'EVENT_CHANGED') + (await countOf('res2', 'EVENT_CANCELLED'));
      await patch({ description: 'Bring your own bat' });
      await patch({ title: 'Cricket match (final)' });
      expect(await countOf('res2', 'EVENT_CHANGED') + (await countOf('res2', 'EVENT_CANCELLED'))).toBe(quiet);

      const moved = await countOf('res2', 'EVENT_CHANGED');
      await patch({ eventDate: eventIn(13) });
      expect(await countOf('res2', 'EVENT_CHANGED')).toBe(moved + 1);

      const called = await countOf('res2', 'EVENT_CANCELLED');
      await patch({ status: 'CANCELLED' });
      expect(await countOf('res2', 'EVENT_CANCELLED')).toBe(called + 1);
      await patch({ description: 'Sorry about that' }); // a cancelled event edited again says nothing more
      expect(await countOf('res2', 'EVENT_CANCELLED')).toBe(called + 1);
    });

    it('reminds the day before, once, only for a planned event open to residents', async () => {
      const adminId = (await prisma.user.findFirstOrThrow({ where: { email: email('admin-Alpha') } })).id;
      const day = new Date(Date.now() + 23 * HOUR);
      const old = new Date(Date.now() - 4 * 24 * HOUR);
      const planned = await prisma.event.create({ data: { societyId, title: 'Planned tomorrow', eventDate: day, createdById: adminId, createdAt: old } });
      await prisma.event.create({ data: { societyId, title: 'Cancelled tomorrow', eventDate: day, status: 'CANCELLED', createdById: adminId, createdAt: old } });
      await prisma.event.create({ data: { societyId, title: 'Hidden tomorrow', eventDate: day, isVisibleToResidents: false, createdById: adminId, createdAt: old } });
      const before = await countOf('res3', 'EVENT_REMINDER');
      expect(await scheduler.eventReminders(new Date())).toBeGreaterThanOrEqual(1);
      expect(await countOf('res3', 'EVENT_REMINDER')).toBe(before + 1);
      expect((await inbox('res3')).find((n) => n.type === 'EVENT_REMINDER' && n.title.includes(planned.title))).toBeTruthy();
      await scheduler.eventReminders(new Date());
      expect(await countOf('res3', 'EVENT_REMINDER')).toBe(before + 1);
    });
  });

  it('runs all the clock-driven jobs together and reports what each sent', async () => {
    const before = (await inbox('res1')).length;
    const result = await scheduler.run(new Date());
    expect(Object.keys(result).sort()).toEqual(['announcements', 'eventReminders', 'meetingReminders']);
    expect((await inbox('res1')).length).toBe(before); // everything above is already told
  });
});
