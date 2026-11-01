/**
 * Setting WhatsApp up from the platform console instead of the server's environment — on a REAL Postgres, against a
 * fake WhatsApp gateway that behaves like OpenWA's session API (create, start, QR, logout).
 *
 * What a fake cannot prove: the key is encrypted at rest and never sent back, the saved connection wins over the
 * environment, a phone can be linked (QR) and unlinked from the console, a dropped session is started again by the
 * sender on its own, and only a platform admin can touch any of it.
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

jest.setTimeout(120_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const PHONE = '95' + String(UNIQUE).slice(-8);
const email = (label: string) => `${label}-${UNIQUE}@test.example`;
const CONSOLE_KEY = 'console-secret-key-123';

/** A stand-in for OpenWA's session API. */
function fakeGateway() {
  const state = {
    validKey: CONSOLE_KEY,
    sessions: [] as { id: string; name: string; status: string; phone: string | null }[],
    created: 0,
    started: [] as string[],
    loggedOut: [] as string[],
    seenKeys: [] as string[],
    sent: [] as { key: string; chatId: string }[],
    /** What starting a session turns it into: a QR waiting, or straight back to ready (credentials still saved). */
    startResult: 'qr_ready' as string,
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      const apiKey = String(req.headers['x-api-key']);
      state.seenKeys.push(apiKey);
      if (apiKey !== state.validKey) return send(401, { message: 'Invalid API key' });
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const url = req.url ?? '';
      const m = /^\/api\/sessions\/([^/]+)(?:\/(\w[\w-]*))?$/.exec(url);

      if (req.method === 'GET' && url === '/api/sessions') return send(200, state.sessions);
      if (req.method === 'POST' && url === '/api/sessions') {
        state.created += 1;
        const s = { id: `sess-${state.created}`, name: body.name, status: 'created', phone: null };
        state.sessions.push(s);
        return send(201, s);
      }
      if (m) {
        const s = state.sessions.find((x) => x.id === m[1]);
        if (!s) return send(404, { message: 'Session not found' });
        if (req.method === 'GET' && !m[2]) return send(200, s);
        if (req.method === 'GET' && m[2] === 'qr') return send(200, { qrCode: 'data:image/png;base64,QUJD', status: s.status });
        if (req.method === 'POST' && m[2] === 'start') {
          state.started.push(s.id);
          s.status = state.startResult;
          if (s.status === 'ready') s.phone = '919000011111';
          return send(200, s);
        }
        if (req.method === 'POST' && m[2] === 'logout') { state.loggedOut.push(s.id); s.status = 'created'; s.phone = null; return send(200, {}); }
        if (req.method === 'POST' && m[2] === 'messages' ) return send(404, {});
      }
      const sendMatch = /^\/api\/sessions\/([^/]+)\/messages\/send-text$/.exec(url);
      if (req.method === 'POST' && sendMatch) {
        const s = state.sessions.find((x) => x.id === sendMatch[1]);
        if (!s || s.status !== 'ready') return send(409, { message: 'Session not ready' });
        state.sent.push({ key: apiKey, chatId: body.chatId });
        return send(201, { messageId: 'm1' });
      }
      send(404, { message: 'no such route' });
    });
  });
  return { state, server };
}

describe('Platform: WhatsApp connection from the console (e2e, real Postgres, fake gateway)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let whatsapp: WhatsappService;
  let store: WhatsappSettingsStore;
  const gw = fakeGateway();
  const http_ = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  let platformToken: string;
  let societyAdmin: string;
  let societyId: string;
  let gatewayUrl: string;

  const save = (body: Record<string, unknown>, token = platformToken) => http_().put('/api/v1/platform/whatsapp/settings').set(auth(token)).send(body);
  const connection = () => http_().get('/api/v1/platform/whatsapp/connection').set(auth(platformToken)).expect(200).then((r) => r.body.data);
  const connect = () => http_().post('/api/v1/platform/whatsapp/connect').set(auth(platformToken));

  beforeAll(async () => {
    await new Promise<void>((r) => gw.server.listen(0, '127.0.0.1', r));
    gatewayUrl = `http://127.0.0.1:${(gw.server.address() as AddressInfo).port}`;
    // The environment points somewhere else entirely, to prove the console's saved connection wins over it.
    process.env.WHATSAPP_API_URL = 'http://127.0.0.1:1';
    process.env.WHATSAPP_API_KEY = 'env-key';
    process.env.WHATSAPP_SESSION_ID = 'env-session';

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

    await prisma.platformWhatsappSettings.deleteMany();
    await prisma.user.create({ data: { email: email('platform'), firstName: 'Plat', lastName: 'Form', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true, isPlatformAdmin: true } });
    platformToken = (await http_().post('/api/v1/auth/login').send({ identifier: email('platform'), password: PASSWORD }).expect(200)).body.data.accessToken;
    const reg = await http_().post('/api/v1/auth/register-society').send({
      society: { name: `E2E WA Console ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: email('soc'), contactPhone: PHONE },
      admin: { firstName: 'Admin', lastName: 'C', email: email('plain'), phone: PHONE, password: PASSWORD },
    }).expect(201);
    societyAdmin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    await prisma.society.update({ where: { id: societyId }, data: { whatsappAllowed: true } });
  });

  afterAll(async () => {
    await prisma.platformWhatsappSettings.deleteMany();
    await prisma.whatsappMessage.deleteMany({ where: { societyId } });
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
    await new Promise((r) => gw.server.close(r));
    delete process.env.WHATSAPP_API_URL;
    delete process.env.WHATSAPP_API_KEY;
    delete process.env.WHATSAPP_SESSION_ID;
  });

  it('is for platform admins only', async () => {
    await http_().get('/api/v1/platform/whatsapp/settings').set(auth(societyAdmin)).expect(403);
    await save({ url: gatewayUrl, apiKey: CONSOLE_KEY }, societyAdmin).expect(403);
    await http_().delete('/api/v1/platform/whatsapp/settings').set(auth(societyAdmin)).expect(403);
    await http_().get('/api/v1/platform/whatsapp/connection').set(auth(societyAdmin)).expect(403);
    await http_().post('/api/v1/platform/whatsapp/connect').set(auth(societyAdmin)).expect(403);
    await http_().post('/api/v1/platform/whatsapp/disconnect').set(auth(societyAdmin)).expect(403);
  });

  it('starts with nothing saved, showing what the environment would use', async () => {
    const res = (await http_().get('/api/v1/platform/whatsapp/settings').set(auth(platformToken)).expect(200)).body.data;
    expect(res).toMatchObject({ source: 'environment', url: null, hasKey: false });
    expect(res.environment).toMatchObject({ url: 'http://127.0.0.1:1', hasKey: true, sessionId: 'env-session' });
  });

  describe('saving the address and key', () => {
    it('refuses what is not a web address, and a first save with no key', async () => {
      await save({ url: 'openwa', apiKey: 'k' }).expect(400);
      await save({ url: 'ftp://openwa:2785', apiKey: 'k' }).expect(400);
      await save({ url: 'http://user:pass@openwa:2785', apiKey: 'k' }).expect(400);
      const noKey = await save({ url: gatewayUrl }).expect(400);
      expect(JSON.stringify(noKey.body)).toMatch(/API key/);
      expect(await prisma.platformWhatsappSettings.count()).toBe(0);
    });

    it('keeps only where the gateway lives, encrypts the key, and never sends it back', async () => {
      const res = (await save({ url: `  ${gatewayUrl}/api/docs/ `, apiKey: CONSOLE_KEY }).expect(200)).body.data;
      expect(res).toMatchObject({ source: 'console', url: gatewayUrl, hasKey: true, keyUnreadable: false, sessionId: null });
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
      gw.state.seenKeys.length = 0;
      await connection();
      expect(await store.creds()).toEqual({ url: gatewayUrl, key: CONSOLE_KEY });
    });
  });

  describe('linking a phone', () => {
    it('creates one session, starts it, and hands back the QR code to scan', async () => {
      const res = (await connect().expect(200)).body.data;
      expect(res).toMatchObject({ hasGateway: true, status: 'qr_ready', qrCode: 'data:image/png;base64,QUJD', problem: null });
      expect(res.sessionId).toBe('sess-1');
      expect(gw.state.sessions).toEqual([expect.objectContaining({ name: 'nghome' })]);
      expect(gw.state.started).toEqual(['sess-1']);
      // saved, so the sender and the status screens use it from now on
      expect((await prisma.platformWhatsappSettings.findUniqueOrThrow({ where: { id: 'singleton' } })).sessionId).toBe('sess-1');
    });

    it('pressing Connect again reuses the session instead of making another', async () => {
      await connect().expect(200);
      expect(gw.state.created).toBe(1);
      expect(gw.state.sessions).toHaveLength(1);
    });

    it('shows the number once the QR code has been scanned, with no QR code left', async () => {
      gw.state.sessions[0].status = 'ready';
      gw.state.sessions[0].phone = '919000011111';
      expect(await connection()).toMatchObject({ status: 'ready', phone: '919000011111', qrCode: null });
    });

    it('then the app sends through that connection, with the console\'s key — not the environment\'s', async () => {
      await http_().patch('/api/v1/societies/my/config').set(auth(societyAdmin)).send({ whatsappEnabled: true }).expect(200);
      await prisma.whatsappMessage.create({ data: { societyId, kind: 'TEST', dedupeKey: `c1-${UNIQUE}`, toPhone: '919876543210', body: 'hello', sendAfter: new Date(Date.now() - 5000) } });
      const out = await whatsapp.drain({ gap: () => 0, ignoreWindow: true });
      expect(out).toMatchObject({ sent: 1, stopped: null });
      expect(gw.state.sent.at(-1)).toMatchObject({ key: CONSOLE_KEY, chatId: '919876543210@c.us' });

      const status = (await http_().get('/api/v1/whatsapp/status').set(auth(societyAdmin)).expect(200)).body.data;
      expect(status).toMatchObject({ configured: true, session: 'ready', sendingFrom: '919000011111' });
    });

    it('starts a session that has dropped by itself, so a restarted gateway does not need anyone', async () => {
      gw.state.sessions[0].status = 'disconnected';
      gw.state.startResult = 'ready'; // credentials still saved: starting brings it straight back
      gw.state.started.length = 0;
      await prisma.whatsappMessage.create({ data: { societyId, kind: 'TEST', dedupeKey: `c2-${UNIQUE}`, toPhone: '919876543211', body: 'hello again', sendAfter: new Date(Date.now() - 5000) } });
      const out = await whatsapp.drain({ gap: () => 0, ignoreWindow: true, now: new Date(Date.now() + 3600_000) });
      expect(gw.state.started).toEqual(['sess-1']);
      expect(out).toMatchObject({ sent: 1 });
      gw.state.startResult = 'qr_ready';
    });

    it('does not keep restarting a session that needs a new scan', async () => {
      gw.state.sessions[0].status = 'qr_ready';
      gw.state.started.length = 0;
      await prisma.whatsappMessage.create({ data: { societyId, kind: 'TEST', dedupeKey: `c3-${UNIQUE}`, toPhone: '919876543212', body: 'x', sendAfter: new Date(Date.now() - 5000) } });
      const out = await whatsapp.drain({ gap: () => 0, ignoreWindow: true });
      expect(out.sent).toBe(0);
      expect(out.stopped).toContain('qr_ready');
      expect(gw.state.started).toEqual([]);
      await prisma.whatsappMessage.deleteMany({ where: { societyId } });
    });

    it('replaces a saved session the gateway no longer knows', async () => {
      gw.state.sessions.length = 0; // the gateway was reset
      const res = (await connect().expect(200)).body.data;
      expect(res.sessionId).toBe('sess-2');
      expect(res.status).toBe('qr_ready');
    });

    it('unlinks the phone from the console', async () => {
      gw.state.sessions[0].status = 'ready';
      gw.state.sessions[0].phone = '919000011111';
      const res = (await http_().post('/api/v1/platform/whatsapp/disconnect').set(auth(platformToken)).expect(200)).body.data;
      expect(gw.state.loggedOut).toEqual(['sess-2']);
      expect(res.phone).toBeNull();
      expect(res.status).not.toBe('ready');
    });
  });

  describe('when the gateway cannot be used', () => {
    it('says the key is wrong, in plain words, without failing the page', async () => {
      gw.state.validKey = 'a-different-key';
      const state = await connection();
      expect(state.problem).toMatch(/refused the API key/);
      const res = await connect().expect(400);
      expect(JSON.stringify(res.body)).toMatch(/refused the API key/);
      gw.state.validKey = CONSOLE_KEY;
    });

    it('says the gateway cannot be reached when the address is wrong', async () => {
      await save({ url: 'http://127.0.0.1:1', apiKey: CONSOLE_KEY, sessionId: 'x' }).expect(200);
      expect((await connection()).problem).toMatch(/could not be reached/);
      await save({ url: gatewayUrl, apiKey: CONSOLE_KEY, sessionId: 'sess-2' }).expect(200);
    });

    it('forgets the session when the address changes to a different gateway', async () => {
      await save({ url: gatewayUrl, apiKey: CONSOLE_KEY, sessionId: 'sess-2' }).expect(200);
      const moved = (await save({ url: 'http://127.0.0.1:9', apiKey: '' }).expect(200)).body.data;
      expect(moved.sessionId).toBeNull();
      await save({ url: gatewayUrl, apiKey: '', sessionId: 'sess-2' }).expect(200);
    });
  });

  describe('which societies may use the platform\'s number', () => {
    let otherSociety: string;
    let otherAdmin: string;
    const allowTo = (id: string, allowed: boolean, token = platformToken) => http_().patch(`/api/v1/societies/${id}/whatsapp`).set(auth(token)).send({ allowed });

    beforeAll(async () => {
      const reg = await http_().post('/api/v1/auth/register-society').send({
        society: { name: `E2E WA Other ${UNIQUE}`, address: '2 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: email('other-soc'), contactPhone: '96' + String(UNIQUE).slice(-8) },
        admin: { firstName: 'Other', lastName: 'Admin', email: email('other'), phone: '96' + String(UNIQUE).slice(-8), password: PASSWORD },
      }).expect(201);
      otherAdmin = reg.body.data.accessToken;
      otherSociety = reg.body.data.memberships[0].societyId;
    });
    afterAll(async () => {
      await prisma.whatsappMessage.deleteMany({ where: { societyId: otherSociety } });
      await prisma.society.update({ where: { id: otherSociety }, data: { deletedAt: new Date() } });
    });

    it('is off for a new society, and only the platform owner can change it', async () => {
      expect((await prisma.society.findUniqueOrThrow({ where: { id: otherSociety } })).whatsappAllowed).toBe(false);
      await allowTo(otherSociety, true, otherAdmin).expect(403); // the society's own admin cannot
      await allowTo(societyId, false, societyAdmin).expect(403); // nor can another society's
      await http_().patch(`/api/v1/societies/${otherSociety}/whatsapp`).set(auth(platformToken)).send({}).expect(400); // a missing value is refused
      expect((await prisma.society.findUniqueOrThrow({ where: { id: otherSociety } })).whatsappAllowed).toBe(false);
    });

    it('another society cannot use the number while this society can', async () => {
      // this society is allowed, the other is not
      const other = await http_().patch('/api/v1/societies/my/config').set(auth(otherAdmin)).send({ whatsappEnabled: true }).expect(403);
      expect(JSON.stringify(other.body)).toMatch(/platform owner/);
      expect(await prisma.societyConfiguration.findUnique({ where: { societyId: otherSociety } }).then((c) => (c?.additionalConfig as any)?.whatsapp?.enabled ?? false)).toBe(false);
      // and the number is not shown to it
      expect((await http_().get('/api/v1/whatsapp/status').set(auth(otherAdmin)).expect(200)).body.data).toMatchObject({ allowed: false, sendingFrom: null, enabled: false });
      // this society is unaffected
      expect((await http_().get('/api/v1/whatsapp/status').set(auth(societyAdmin)).expect(200)).body.data).toMatchObject({ allowed: true });
    });

    it('the platform owner allows it, the society can switch it on, and stopping it again drops what was waiting', async () => {
      const res = (await allowTo(otherSociety, true).expect(200)).body.data;
      expect(res).toMatchObject({ id: otherSociety, whatsappAllowed: true });
      await http_().patch('/api/v1/societies/my/config').set(auth(otherAdmin)).send({ whatsappEnabled: true }).expect(200);

      await prisma.whatsappMessage.createMany({
        data: [
          { societyId: otherSociety, kind: 'REMINDER', dedupeKey: `p1-${UNIQUE}`, toPhone: '919876500001', body: 'x', status: 'PENDING' },
          { societyId: otherSociety, kind: 'REMINDER', dedupeKey: `p2-${UNIQUE}`, toPhone: '919876500002', body: 'x', status: 'SENT', sentAt: new Date() },
          { societyId, kind: 'REMINDER', dedupeKey: `mine-${UNIQUE}`, toPhone: '919876500003', body: 'x', status: 'PENDING' },
        ],
      });
      const stopped = (await allowTo(otherSociety, false).expect(200)).body.data;
      expect(stopped.whatsappAllowed).toBe(false);

      const rows = await prisma.whatsappMessage.findMany({ where: { dedupeKey: { in: [`p1-${UNIQUE}`, `p2-${UNIQUE}`, `mine-${UNIQUE}`] } } });
      const by = (k: string) => rows.find((r) => r.dedupeKey === `${k}-${UNIQUE}`)!;
      expect(by('p1')).toMatchObject({ status: 'FAILED', lastError: 'This society is not allowed to send WhatsApp messages.' });
      expect(by('p2').status).toBe('SENT'); // what was already sent stays as it was
      expect(by('mine').status).toBe('PENDING'); // another society's queue is untouched
      await prisma.whatsappMessage.deleteMany({ where: { societyId } });
    });

    it('is recorded in the audit log, and shown in the platform\'s society list', async () => {
      await allowTo(otherSociety, true).expect(200);
      const audit = await prisma.auditLog.findFirst({ where: { societyId: otherSociety, entityType: 'Society', newValues: { path: ['action'], equals: 'WHATSAPP_ALLOWED' } }, orderBy: { createdAt: 'desc' } });
      expect(audit).toBeTruthy();
      const list = (await http_().get('/api/v1/societies?limit=100').set(auth(platformToken)).expect(200)).body.data as any[];
      expect(list.find((s) => s.id === otherSociety)).toMatchObject({ whatsappAllowed: true });
      expect(list.find((s) => s.id === societyId)).toMatchObject({ whatsappAllowed: true });
      await allowTo(otherSociety, false).expect(200);
    });
  });

  it('forgetting the console settings goes back to the environment, and does not break sending', async () => {
    const res = (await http_().delete('/api/v1/platform/whatsapp/settings').set(auth(platformToken)).expect(200)).body.data;
    expect(res).toMatchObject({ source: 'environment', url: null, hasKey: false });
    expect(await prisma.platformWhatsappSettings.count()).toBe(0);
    expect(await store.effective()).toMatchObject({ url: 'http://127.0.0.1:1', key: 'env-key', sessionId: 'env-session' });
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'PlatformWhatsappSettings' }, orderBy: { createdAt: 'desc' } });
    expect(audit?.newValues).toEqual({ removed: true });
  });
});
