/**
 * WhatsApp set up from the app — on a REAL Postgres, against a fake WhatsApp gateway that behaves like OpenWA's session
 * API (create, start, QR, logout, stop, delete).
 *
 * The platform owner saves the gateway's address and key once (encrypted at rest, never sent back) and decides which
 * societies may use it. Each society then links its OWN number: its own session on the gateway, created, started and
 * scanned from that society's settings. What a fake cannot prove: the key is never exposed, a society's session id comes
 * only from its own row, two societies never share a session or see each other's number, a dropped session is started
 * again by the sender, and stopping or erasing a society frees its session.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { WhatsappSettingsStore } from '../src/whatsapp/whatsapp-settings.store';
import { SocietyPurgeService } from '../src/societies/society-purge.service';

jest.setTimeout(120_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const RUN = String(Math.floor(10000 + Math.random() * 89999));
const phoneOf = (n: number) => '95' + RUN + String(n).padStart(3, '0');
// Lower case: login looks an email up in lower case.
const email = (label: string) => `${label}-${UNIQUE}@test.example`.toLowerCase();
const CONSOLE_KEY = 'console-secret-key-123';
const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));

interface FakeSession { id: string; name: string; status: string; phone: string | null }

/** A stand-in for OpenWA's session API. */
function fakeGateway() {
  const state = {
    validKey: CONSOLE_KEY,
    sessions: [] as FakeSession[],
    created: 0,
    started: [] as string[],
    stopped: [] as string[],
    deleted: [] as string[],
    loggedOut: [] as string[],
    sent: [] as { session: string; key: string; chatId: string }[],
    /** What starting a session turns it into: a QR waiting, or straight back to ready (credentials still saved). */
    startResult: 'qr_ready' as string,
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      const apiKey = String(req.headers['x-api-key']);
      if (apiKey !== state.validKey) return send(401, { message: 'Invalid API key' });
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const url = req.url ?? '';
      const m = /^\/api\/sessions\/([^/]+)(?:\/([\w-]+))?(?:\/send-text)?$/.exec(url);

      if (req.method === 'GET' && url === '/api/sessions') return send(200, state.sessions);
      if (req.method === 'POST' && url === '/api/sessions') {
        state.created += 1;
        const s = { id: `sess-${state.created}`, name: body.name, status: 'created', phone: null };
        state.sessions.push(s);
        return send(201, s);
      }
      const sendMatch = /^\/api\/sessions\/([^/]+)\/messages\/send-text$/.exec(url);
      if (req.method === 'POST' && sendMatch) {
        const s = state.sessions.find((x) => x.id === sendMatch[1]);
        if (!s || s.status !== 'ready') return send(409, { message: 'Session not ready' });
        state.sent.push({ session: s.id, key: apiKey, chatId: body.chatId });
        return send(201, { messageId: 'm1' });
      }
      if (m) {
        const s = state.sessions.find((x) => x.id === m[1]);
        if (!s) return send(404, { message: 'Session not found' });
        if (req.method === 'GET' && !m[2]) return send(200, s);
        if (req.method === 'DELETE' && !m[2]) { state.deleted.push(s.id); state.sessions.splice(state.sessions.indexOf(s), 1); return send(204, {}); }
        if (req.method === 'GET' && m[2] === 'qr') return send(200, { qrCode: `data:image/png;base64,${Buffer.from(s.id).toString('base64')}`, status: s.status });
        if (req.method === 'POST' && m[2] === 'start') {
          state.started.push(s.id);
          s.status = state.startResult;
          if (s.status === 'ready') s.phone = `9190000${s.id.replace(/\D/g, '').padStart(5, '0')}`;
          return send(200, s);
        }
        if (req.method === 'POST' && m[2] === 'stop') { state.stopped.push(s.id); s.status = 'disconnected'; return send(200, s); }
        if (req.method === 'POST' && m[2] === 'logout') { state.loggedOut.push(s.id); s.status = 'created'; s.phone = null; return send(200, {}); }
      }
      send(404, { message: 'no such route' });
    });
  });
  return { state, server };
}

describe('WhatsApp: the platform\'s gateway and each society\'s own number (e2e, real Postgres, fake gateway)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let whatsapp: WhatsappService;
  let store: WhatsappSettingsStore;
  let purge: SocietyPurgeService;
  const gw = fakeGateway();
  const http_ = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  let platformToken: string;
  let platformUserId: string;
  let gatewayUrl: string;

  interface Soc { id: string; admin: string; accountant: string; resident: string }
  let A: Soc;
  let B: Soc;

  const save = (body: Record<string, unknown>, token = platformToken) => http_().put('/api/v1/platform/whatsapp/settings').set(auth(token)).send(body);
  const allowTo = (id: string, allowed: boolean, token = platformToken) => http_().patch(`/api/v1/societies/${id}/whatsapp`).set(auth(token)).send({ allowed });
  const connection = (s: Soc) => http_().get('/api/v1/whatsapp/connection').set(auth(s.admin)).expect(200).then((r) => r.body.data);
  const connect = (s: Soc, token = s.admin) => http_().post('/api/v1/whatsapp/connect').set(auth(token));
  const sessionOf = async (s: Soc) => (await prisma.society.findUniqueOrThrow({ where: { id: s.id } })).whatsappSessionId;

  async function makeUser(label: string, society: string, role: 'SOCIETY_ACCOUNTANT' | 'RESIDENT', n: number) {
    const user = await prisma.user.create({ data: { email: email(label), firstName: label, lastName: 'T', phone: phoneOf(n), passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true } });
    await prisma.societyMembership.create({ data: { societyId: society, userId: user.id, role, status: 'ACTIVE', isPrimary: role === 'RESIDENT' } });
    return (await http_().post('/api/v1/auth/login').send({ identifier: email(label), password: PASSWORD }).expect(200)).body.data.accessToken as string;
  }

  async function registerSociety(label: string, n: number): Promise<Soc> {
    const ph = '96' + RUN + String(n).padStart(3, '0');
    const reg = await http_().post('/api/v1/auth/register-society').send({
      society: { name: `E2E WA ${label} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: email(`soc-${label}`), contactPhone: ph },
      admin: { firstName: label, lastName: 'Admin', email: email(`admin-${label}`), phone: ph, password: PASSWORD },
    }).expect(201);
    const id = reg.body.data.memberships[0].societyId as string;
    return {
      id,
      admin: reg.body.data.accessToken as string,
      accountant: await makeUser(`acct-${label}`, id, 'SOCIETY_ACCOUNTANT', n + 10),
      resident: await makeUser(`res-${label}`, id, 'RESIDENT', n + 20),
    };
  }

  beforeAll(async () => {
    await new Promise<void>((r) => gw.server.listen(0, '127.0.0.1', r));
    gatewayUrl = `http://127.0.0.1:${(gw.server.address() as AddressInfo).port}`;
    // The environment points somewhere else entirely, to prove the console's saved gateway wins over it.
    process.env.WHATSAPP_API_URL = 'http://127.0.0.1:1';
    process.env.WHATSAPP_API_KEY = 'env-key';

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    whatsapp = moduleFixture.get(WhatsappService);
    store = moduleFixture.get(WhatsappSettingsStore);
    purge = moduleFixture.get(SocietyPurgeService);

    await prisma.platformWhatsappSettings.deleteMany();
    // Sessions left on societies by earlier runs belong to a different fake gateway: forget them.
    await prisma.society.updateMany({ data: { whatsappSessionId: null } });
    store.invalidate();
    platformUserId = (await prisma.user.create({ data: { email: email('platform'), firstName: 'Plat', lastName: 'Form', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true, isPlatformAdmin: true } })).id;
    platformToken = (await http_().post('/api/v1/auth/login').send({ identifier: email('platform'), password: PASSWORD }).expect(200)).body.data.accessToken;
    A = await registerSociety('Alpha', 1);
    B = await registerSociety('Bravo', 2);
  });

  afterAll(async () => {
    await prisma.platformWhatsappSettings.deleteMany();
    store.invalidate();
    for (const s of [A, B]) {
      if (!s) continue;
      await prisma.whatsappMessage.deleteMany({ where: { societyId: s.id } });
      await prisma.society.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
    }
    await app.close();
    await new Promise((r) => gw.server.close(r));
    delete process.env.WHATSAPP_API_URL;
    delete process.env.WHATSAPP_API_KEY;
  });

  /* ─────────────────────────── the platform's gateway ─────────────────────────── */

  describe('the platform owner saves the gateway', () => {
    it('is for platform admins only', async () => {
      await http_().get('/api/v1/platform/whatsapp/settings').set(auth(A.admin)).expect(403);
      await save({ url: gatewayUrl, apiKey: CONSOLE_KEY }, A.admin).expect(403);
      await http_().delete('/api/v1/platform/whatsapp/settings').set(auth(A.admin)).expect(403);
      await http_().get('/api/v1/platform/whatsapp/sessions').set(auth(A.admin)).expect(403);
    });

    it('starts with nothing saved, showing what the environment would use', async () => {
      const res = (await http_().get('/api/v1/platform/whatsapp/settings').set(auth(platformToken)).expect(200)).body.data;
      expect(res).toMatchObject({ source: 'environment', url: null, hasKey: false });
      expect(res.environment).toMatchObject({ url: 'http://127.0.0.1:1', hasKey: true });
    });

    it('refuses what is not a web address, and a first save with no key', async () => {
      await save({ url: 'openwa', apiKey: 'k' }).expect(400);
      await save({ url: 'ftp://openwa:2785', apiKey: 'k' }).expect(400);
      await save({ url: 'http://user:pass@openwa:2785', apiKey: 'k' }).expect(400);
      expect(JSON.stringify((await save({ url: gatewayUrl }).expect(400)).body)).toMatch(/API key/);
      expect(await prisma.platformWhatsappSettings.count()).toBe(0);
    });

    it('keeps only where the gateway lives, encrypts the key, and never sends it back', async () => {
      const res = (await save({ url: `  ${gatewayUrl}/api/docs/ `, apiKey: CONSOLE_KEY }).expect(200)).body.data;
      expect(res).toMatchObject({ source: 'console', url: gatewayUrl, hasKey: true, keyUnreadable: false });
      expect(JSON.stringify(res)).not.toContain(CONSOLE_KEY);
      const row = await prisma.platformWhatsappSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
      expect(row.apiKeyEnc.startsWith('v1.')).toBe(true);
      expect(row.apiKeyEnc).not.toContain(CONSOLE_KEY);
      const audit = await prisma.auditLog.findFirst({ where: { entityType: 'PlatformWhatsappSettings' }, orderBy: { createdAt: 'desc' } });
      expect(audit?.action).toBe('CONFIG_CHANGED');
      expect(JSON.stringify(audit)).not.toContain(CONSOLE_KEY);
    });

    it('a blank key keeps the saved one', async () => {
      await save({ url: gatewayUrl, apiKey: '' }).expect(200);
      store.invalidate();
      expect(await store.creds()).toEqual({ url: gatewayUrl, key: CONSOLE_KEY });
    });
  });

  /* ─────────────────────────── which societies may use it ─────────────────────────── */

  describe('which societies may link a number', () => {
    it('is off for a new society, and only the platform owner can change it', async () => {
      expect((await prisma.society.findUniqueOrThrow({ where: { id: A.id } })).whatsappAllowed).toBe(false);
      await allowTo(A.id, true, A.admin).expect(403);
      await allowTo(B.id, true, A.admin).expect(403);
      await http_().patch(`/api/v1/societies/${A.id}/whatsapp`).set(auth(platformToken)).send({}).expect(400);
    });

    it('a society that is not allowed cannot connect a number', async () => {
      const res = await connect(A).expect(403);
      expect(messageOf(res.body)).toMatch(/Ask the platform owner/);
      expect(gw.state.created).toBe(0);
      expect(await connection(A)).toMatchObject({ hasGateway: true, allowed: false, linked: false, status: null });
    });

    it('allowing is recorded in the audit log and shown in the societies list', async () => {
      await allowTo(A.id, true).expect(200);
      await allowTo(B.id, true).expect(200);
      const audit = await prisma.auditLog.findFirst({ where: { societyId: A.id, entityType: 'Society', newValues: { path: ['action'], equals: 'WHATSAPP_ALLOWED' } } });
      expect(audit).toBeTruthy();
      const list = (await http_().get('/api/v1/societies?limit=100').set(auth(platformToken)).expect(200)).body.data as any[];
      expect(list.find((s) => s.id === A.id)).toMatchObject({ whatsappAllowed: true });
    });
  });

  /* ─────────────────────────── each society links its own number ─────────────────────────── */

  describe('a society links its own number', () => {
    it('only the society\'s admin can connect or unlink, not an accountant or a resident', async () => {
      await connect(A, A.accountant).expect(403);
      await connect(A, A.resident).expect(403);
      await http_().post('/api/v1/whatsapp/disconnect').set(auth(A.accountant)).expect(403);
      expect(gw.state.created).toBe(0);
      // an accountant may look, a resident may not
      await http_().get('/api/v1/whatsapp/connection').set(auth(A.accountant)).expect(200);
      await http_().get('/api/v1/whatsapp/connection').set(auth(A.resident)).expect(403);
    });

    it('creates the society\'s own session, starts it, and hands back the QR code to scan', async () => {
      const res = (await connect(A).expect(200)).body.data;
      expect(res).toMatchObject({ hasGateway: true, allowed: true, linked: true, status: 'qr_ready', problem: null });
      expect(res.qrCode).toMatch(/^data:image\/png;base64,/);
      expect(gw.state.sessions).toEqual([expect.objectContaining({ name: `ng-${A.id}` })]);
      expect(await sessionOf(A)).toBe(gw.state.sessions[0].id);
      expect(gw.state.started).toEqual([gw.state.sessions[0].id]);
    });

    it('pressing Connect again reuses the society\'s session instead of making another', async () => {
      await connect(A).expect(200);
      expect(gw.state.created).toBe(1);
      expect(gw.state.sessions).toHaveLength(1);
    });

    it('another society gets a session of its own, and the two never share', async () => {
      await connect(B).expect(200);
      expect(gw.state.created).toBe(2);
      const a = await sessionOf(A);
      const b = await sessionOf(B);
      expect(b).not.toBe(a);
      expect(gw.state.sessions.map((s) => s.name).sort()).toEqual([`ng-${A.id}`, `ng-${B.id}`].sort());
      // B's connection view shows B's QR, never A's
      expect((await connection(B)).qrCode).toContain(Buffer.from(b as string).toString('base64'));
      expect((await connection(A)).qrCode).toContain(Buffer.from(a as string).toString('base64'));
    });

    it('shows each society its own number once its phone is scanned, and not the other\'s', async () => {
      const a = gw.state.sessions.find((s) => s.name === `ng-${A.id}`) as FakeSession;
      const b = gw.state.sessions.find((s) => s.name === `ng-${B.id}`) as FakeSession;
      a.status = 'ready'; a.phone = '919000011111';
      b.status = 'ready'; b.phone = '919000022222';
      expect(await connection(A)).toMatchObject({ status: 'ready', phone: '919000011111', qrCode: null });
      expect(await connection(B)).toMatchObject({ status: 'ready', phone: '919000022222', qrCode: null });
      const sa = (await http_().get('/api/v1/whatsapp/status').set(auth(A.admin)).expect(200)).body.data;
      expect(sa).toMatchObject({ configured: true, allowed: true, hasSession: true, session: 'ready', sendingFrom: '919000011111' });
      expect(JSON.stringify(sa)).not.toContain('919000022222');
    });

    it('then each society sends through its own session with the gateway key', async () => {
      for (const s of [A, B]) {
        await http_().patch('/api/v1/societies/my/config').set(auth(s.admin)).send({ whatsappEnabled: true }).expect(200);
        await prisma.whatsappMessage.create({ data: { societyId: s.id, kind: 'TEST', dedupeKey: `c1-${UNIQUE}-${s.id}`, toPhone: '919876543210', body: 'hello', sendAfter: new Date(Date.now() - 5000) } });
      }
      const out = await whatsapp.drain({ gap: () => 0, ignoreWindow: true });
      expect(out).toMatchObject({ sent: 2, stopped: null });
      expect(gw.state.sent.map((s) => s.session).sort()).toEqual([(await sessionOf(A)) as string, (await sessionOf(B)) as string].sort());
      expect(gw.state.sent.every((s) => s.key === CONSOLE_KEY)).toBe(true); // the console's key, not the environment's
    });

    it('starts a session that has dropped by itself, so a restarted gateway does not need anyone', async () => {
      const a = gw.state.sessions.find((s) => s.name === `ng-${A.id}`) as FakeSession;
      a.status = 'disconnected';
      gw.state.startResult = 'ready'; // credentials still saved: starting brings it straight back
      gw.state.started.length = 0;
      await prisma.whatsappMessage.create({ data: { societyId: A.id, kind: 'TEST', dedupeKey: `c2-${UNIQUE}`, toPhone: '919876543211', body: 'hello again', sendAfter: new Date(Date.now() - 5000) } });
      const out = await whatsapp.drain({ gap: () => 0, ignoreWindow: true, now: new Date(Date.now() + 3600_000) });
      expect(gw.state.started).toEqual([a.id]); // only A's session, not B's
      expect(out).toMatchObject({ sent: 1 });
      gw.state.startResult = 'qr_ready';
    });

    it('does not keep restarting a session that needs a new scan', async () => {
      const a = gw.state.sessions.find((s) => s.name === `ng-${A.id}`) as FakeSession;
      a.status = 'qr_ready';
      gw.state.started.length = 0;
      await prisma.whatsappMessage.create({ data: { societyId: A.id, kind: 'TEST', dedupeKey: `c3-${UNIQUE}`, toPhone: '919876543212', body: 'x', sendAfter: new Date(Date.now() - 5000) } });
      const out = await whatsapp.drain({ gap: () => 0, ignoreWindow: true });
      expect(out.sent).toBe(0);
      expect(out.stopped).toContain('qr_ready');
      expect(gw.state.started).toEqual([]);
      await prisma.whatsappMessage.deleteMany({ where: { societyId: A.id } });
    });

    it('replaces a saved session the gateway no longer knows', async () => {
      const old = (await sessionOf(A)) as string;
      gw.state.sessions.splice(gw.state.sessions.findIndex((s) => s.id === old), 1); // the gateway was reset
      const res = (await connect(A).expect(200)).body.data;
      expect(res.status).toBe('qr_ready');
      expect(await sessionOf(A)).not.toBe(old);
      expect(gw.state.sessions.filter((s) => s.name === `ng-${A.id}`)).toHaveLength(1);
    });

    it('unlinks only that society\'s phone', async () => {
      const a = gw.state.sessions.find((s) => s.name === `ng-${A.id}`) as FakeSession;
      a.status = 'ready'; a.phone = '919000011111';
      const res = (await http_().post('/api/v1/whatsapp/disconnect').set(auth(A.admin)).expect(200)).body.data;
      expect(gw.state.loggedOut).toEqual([a.id]);
      expect(res.phone).toBeNull();
      expect(res.status).not.toBe('ready');
      expect((await connection(B)).status).toBe('ready'); // B untouched
    });
  });

  /* ─────────────────────────── seeing and freeing sessions ─────────────────────────── */

  describe('the platform owner sees the sessions, and stopping a society frees its own', () => {
    it('lists every society that linked a number, with its status, and any session that belongs to nobody', async () => {
      await prisma.whatsappMessage.deleteMany({});
      gw.state.sessions.push({ id: 'sess-orphan', name: 'ng-someone-gone', status: 'ready', phone: '919000099999' });
      const res = (await http_().get('/api/v1/platform/whatsapp/sessions').set(auth(platformToken)).expect(200)).body.data;
      expect(res).toMatchObject({ configured: true, reachable: true, problem: null });
      const mine = res.sessions.filter((s: any) => [A.id, B.id].includes(s.societyId));
      expect(mine.map((s: any) => s.name).sort()).toEqual([`E2E WA Alpha ${UNIQUE}`, `E2E WA Bravo ${UNIQUE}`].sort());
      expect(mine.find((s: any) => s.societyId === B.id)).toMatchObject({ allowed: true, status: 'ready', phone: '919000022222', deleted: false });
      expect(res.orphans).toEqual([{ id: 'sess-orphan', name: 'ng-someone-gone', status: 'ready', phone: '919000099999' }]);
    });

    it('says plainly when the gateway cannot be reached or refuses the key', async () => {
      gw.state.validKey = 'a-different-key';
      store.invalidate();
      const res = (await http_().get('/api/v1/platform/whatsapp/sessions').set(auth(platformToken)).expect(200)).body.data;
      expect(res.reachable).toBe(false);
      expect(res.problem).toMatch(/refused the API key/);
      expect((await connection(B)).problem).toMatch(/refused the API key/);
      expect(messageOf((await connect(B).expect(400)).body)).toMatch(/refused the API key/);
      gw.state.validKey = CONSOLE_KEY;

      await save({ url: 'http://127.0.0.1:1', apiKey: '' }).expect(200);
      expect((await http_().get('/api/v1/platform/whatsapp/sessions').set(auth(platformToken)).expect(200)).body.data.problem).toMatch(/could not be reached/);
      await save({ url: gatewayUrl, apiKey: '' }).expect(200);
    });

    it('stopping a society stops its own session and no other, and drops its queue', async () => {
      const a = gw.state.sessions.find((s) => s.name === `ng-${A.id}`) as FakeSession;
      const b = gw.state.sessions.find((s) => s.name === `ng-${B.id}`) as FakeSession;
      await prisma.whatsappMessage.create({ data: { societyId: B.id, kind: 'REMINDER', dedupeKey: `q-${UNIQUE}`, toPhone: '919876500001', body: 'x' } });
      await allowTo(B.id, false).expect(200);
      expect(gw.state.stopped).toEqual([b.id]);
      expect(gw.state.stopped).not.toContain(a.id);
      expect((await prisma.whatsappMessage.findFirstOrThrow({ where: { dedupeKey: `q-${UNIQUE}` } })).status).toBe('FAILED');
      expect(await sessionOf(B)).toBe(b.id); // the link is kept: allowing again brings it back
      expect((await connection(B))).toMatchObject({ allowed: false, status: null });
      await allowTo(B.id, true).expect(200);
    });

    it('suspending a society stops its session too', async () => {
      gw.state.stopped.length = 0;
      const b = gw.state.sessions.find((s) => s.name === `ng-${B.id}`) as FakeSession;
      await http_().patch(`/api/v1/societies/${B.id}/status`).set(auth(platformToken)).send({ isActive: false }).expect(200);
      expect(gw.state.stopped).toEqual([b.id]);
      await http_().patch(`/api/v1/societies/${B.id}/status`).set(auth(platformToken)).send({ isActive: true }).expect(200);
    });

    it('erasing a society for good removes its session from the gateway', async () => {
      const C = await registerSociety('Charlie', 3);
      await allowTo(C.id, true).expect(200);
      await connect(C).expect(200);
      const cSession = (await sessionOf(C)) as string;
      expect(gw.state.sessions.some((s) => s.id === cSession)).toBe(true);
      await purge.purge(C.id, `E2E WA Charlie ${UNIQUE}`, platformUserId);
      expect(gw.state.deleted).toContain(cSession);
      expect(gw.state.sessions.some((s) => s.id === cSession)).toBe(false);
    });
  });

  it('forgetting the console settings goes back to the environment', async () => {
    const res = (await http_().delete('/api/v1/platform/whatsapp/settings').set(auth(platformToken)).expect(200)).body.data;
    expect(res).toMatchObject({ source: 'environment', url: null, hasKey: false });
    expect(await prisma.platformWhatsappSettings.count()).toBe(0);
    store.invalidate();
    expect(await store.creds()).toEqual({ url: 'http://127.0.0.1:1', key: 'env-key' });
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'PlatformWhatsappSettings' }, orderBy: { createdAt: 'desc' } });
    expect(audit?.newValues).toEqual({ removed: true });
  });
});
