/**
 * Expense receipts (camera photos and PDFs) against a REAL Postgres, through real HTTP, with the SFTP
 * server replaced by an in-memory one so the files can be counted.
 *
 * What a fake cannot prove: that the cap holds when several phones add receipts to one expense at
 * once, that a refused upload leaves no file behind, that societies cannot reach each other's
 * receipts, and that a receipt is not readable through the general documents routes.
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
import { SftpStorageService } from '../src/documents/sftp-storage.service';
import { MAX_RECEIPTS_PER_EXPENSE } from '../src/expenses/expense-receipts';

jest.setTimeout(60_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const phone = (n: number) => '93' + String(UNIQUE).slice(-7) + String(n);

/** The server's disk, in memory. */
const disk = new Map<string, Buffer>();
const fakeSftp = {
  getBasePath: () => '/ng-home-documents',
  onModuleInit: () => undefined,
  checkStorage: async () => ({ ok: true }),
  upload: async (buffer: Buffer, path: string) => { disk.set(path, buffer); },
  download: async (path: string) => {
    const b = disk.get(path);
    if (!b) throw new Error('no such file');
    return b;
  },
  remove: async (path: string) => { disk.delete(path); },
};

/** What a phone camera hands over: a JPEG (starts with the JPEG marker). */
const jpeg = (fill = 'a') => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(fill.repeat(64))]);
const pdf = () => Buffer.from('%PDF-1.4\n% receipt\n');

describe('Expense receipts (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let adminA: string;
  let societyA: string;
  let accountantA: string;
  let residentA: string;
  let committeeA: string;
  let adminB: string;
  let societyB: string;

  const newExpense = async (token: string, description = 'Plumber') =>
    (await http().post('/api/v1/expenses').set(auth(token)).send({ description, amount: 500, category: 'REPAIRS', expenseDate: '2026-10-01' }).expect(201)).body.data.id as string;
  const attach = (token: string, expenseId: string, body: Buffer, name: string, type: string) =>
    http().post(`/api/v1/expenses/${expenseId}/receipts`).set(auth(token)).attach('file', body, { filename: name, contentType: type });
  const attachJpeg = (token: string, expenseId: string, fill = 'a') => attach(token, expenseId, jpeg(fill), `bill-${fill}.jpg`, 'image/jpeg');
  const receiptsOf = async (token: string, expenseId: string) =>
    (await http().get(`/api/v1/expenses/${expenseId}`).set(auth(token)).expect(200)).body.data.documents as { id: string; fileName: string }[];

  async function makeUser(label: string, societyId: string, role: SystemRole, flatId: string | null = null): Promise<string> {
    const email = `${label}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: { email, firstName: label, lastName: 'Test', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId, role, status: 'ACTIVE', isPrimary: role === SystemRole.RESIDENT } });
    const login = await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200);
    return login.body.data.accessToken as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60 }) })
      .overrideProvider(SftpStorageService)
      .useValue(fakeSftp)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = moduleFixture.get(PrismaService);

    const register = async (tag: string, ph: string) =>
      http()
        .post('/api/v1/auth/register-society')
        .send({
          society: { name: `E2E Receipts ${tag} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-${tag}-${UNIQUE}@test.example`, contactPhone: ph },
          admin: { firstName: 'Admin', lastName: tag, email: `admin-${tag}-${UNIQUE}@test.example`, phone: ph, password: PASSWORD },
        })
        .expect(201);
    const a = await register('ra', phone(1));
    adminA = a.body.data.accessToken;
    societyA = a.body.data.memberships[0].societyId;
    const b = await register('rb', phone(2));
    adminB = b.body.data.accessToken;
    societyB = b.body.data.memberships[0].societyId;

    const bld = await http().post('/api/v1/buildings').set(auth(adminA)).send({ name: 'RA', code: 'RA' }).expect(201);
    const flat = (await http().post('/api/v1/flats').set(auth(adminA)).send({ buildingId: bld.body.data.id, unitNumber: '101', flatCode: 'RA-101' }).expect(201)).body.data.id;
    accountantA = await makeUser('racct', societyA, SystemRole.SOCIETY_ACCOUNTANT);
    residentA = await makeUser('rres', societyA, SystemRole.RESIDENT, flat);
    committeeA = await makeUser('rcom', societyA, SystemRole.COMMITTEE_MEMBER);
  });

  afterAll(async () => {
    if (societyA) await prisma.society.update({ where: { id: societyA }, data: { deletedAt: new Date() } });
    if (societyB) await prisma.society.update({ where: { id: societyB }, data: { deletedAt: new Date() } });
    await app.close();
  });

  beforeEach(() => disk.clear());

  describe('attaching and reading back', () => {
    it('keeps a camera photo against the expense and gives the same bytes back', async () => {
      const id = await newExpense(adminA);
      const photo = jpeg('x');
      const res = await attach(adminA, id, photo, 'IMG_2031.jpg', 'image/jpeg').expect(201);
      expect(res.body.data).toMatchObject({ fileName: 'IMG_2031.jpg', mimeType: 'image/jpeg' });
      expect(JSON.stringify(res.body)).not.toContain('/society/expenses/'); // the storage path never reaches a client

      const docs = await receiptsOf(adminA, id);
      expect(docs).toHaveLength(1);
      const file = await http()
        .get(`/api/v1/expenses/${id}/receipts/${docs[0].id}/file`)
        .set(auth(adminA))
        // Hand back the raw bytes; the default parser would try to interpret them.
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(file.headers['content-type']).toContain('image/jpeg');
      expect((file.body as Buffer).equals(photo)).toBe(true);
    });

    it('shows the receipts on the list as well, so the app can show a count without a call per expense', async () => {
      const id = await newExpense(adminA, 'Listed');
      await attachJpeg(adminA, id).expect(201);
      await attach(adminA, id, pdf(), 'bill.pdf', 'application/pdf').expect(201);
      const list = (await http().get('/api/v1/expenses?limit=100').set(auth(adminA)).expect(200)).body.data as { id: string; documents: unknown[] }[];
      expect(list.find((e) => e.id === id)!.documents).toHaveLength(2);
    });

    it('lets the accountant add and read receipts too', async () => {
      const id = await newExpense(accountantA);
      await attachJpeg(accountantA, id).expect(201);
      expect(await receiptsOf(accountantA, id)).toHaveLength(1);
    });

    it('keeps an expense with no receipts at an empty list', async () => {
      expect(await receiptsOf(adminA, await newExpense(adminA))).toEqual([]);
    });
  });

  describe('what is refused — and leaves nothing on the server', () => {
    it('refuses a web page renamed to look like a photo', async () => {
      const id = await newExpense(adminA);
      await attach(adminA, id, Buffer.from('<html><script>alert(1)</script></html>'), 'bill.jpg', 'image/jpeg').expect(400);
      expect(disk.size).toBe(0);
      expect(await receiptsOf(adminA, id)).toEqual([]);
    });

    it('refuses an office document — a receipt is a photo or a PDF', async () => {
      const id = await newExpense(adminA);
      await attach(adminA, id, Buffer.from('a,b\n1,2\n'), 'bill.csv', 'text/csv').expect(400);
      expect(disk.size).toBe(0);
    });

    it('refuses a request with no file', async () => {
      const id = await newExpense(adminA);
      await http().post(`/api/v1/expenses/${id}/receipts`).set(auth(adminA)).expect(400);
    });

    it('refuses a receipt for a rejected expense', async () => {
      const id = await newExpense(adminA);
      await http().post(`/api/v1/expenses/${id}/reject`).set(auth(adminA)).send({ reason: 'Not needed' }).expect(201);
      await attachJpeg(adminA, id).expect(403);
      expect(disk.size).toBe(0);
    });

    it('refuses an expense that is not there', async () => {
      await attachJpeg(adminA, '00000000-0000-4000-8000-000000000000').expect(404);
      expect(disk.size).toBe(0);
    });
  });

  describe('the cap', () => {
    it(`allows ${MAX_RECEIPTS_PER_EXPENSE} and refuses the next, leaving no file for it`, async () => {
      const id = await newExpense(adminA);
      for (let i = 0; i < MAX_RECEIPTS_PER_EXPENSE; i++) await attachJpeg(adminA, id, String(i)).expect(201);
      const over = await attachJpeg(adminA, id, 'z').expect(400);
      expect(over.body.message ?? over.body.error?.message ?? JSON.stringify(over.body)).toMatch(/at most/);
      expect(disk.size).toBe(MAX_RECEIPTS_PER_EXPENSE);
      expect(await receiptsOf(adminA, id)).toHaveLength(MAX_RECEIPTS_PER_EXPENSE);
    });

    it('holds when several phones add at the same moment — never more than the cap, and no stray files', async () => {
      const id = await newExpense(adminA);
      const tries = MAX_RECEIPTS_PER_EXPENSE + 3;
      const results = await Promise.all(Array.from({ length: tries }, (_, i) => attachJpeg(adminA, id, String(i))));
      const ok = results.filter((r) => r.status === 201).length;
      expect(ok).toBe(MAX_RECEIPTS_PER_EXPENSE);
      expect(results.filter((r) => r.status === 400)).toHaveLength(tries - MAX_RECEIPTS_PER_EXPENSE);
      expect(await receiptsOf(adminA, id)).toHaveLength(MAX_RECEIPTS_PER_EXPENSE);
      expect(disk.size).toBe(MAX_RECEIPTS_PER_EXPENSE);
    });

    it('counts per expense, not across them', async () => {
      const one = await newExpense(adminA);
      const two = await newExpense(adminA);
      for (let i = 0; i < MAX_RECEIPTS_PER_EXPENSE; i++) await attachJpeg(adminA, one, String(i)).expect(201);
      await attachJpeg(adminA, two).expect(201);
    });
  });

  describe('removing', () => {
    it('removes a receipt from a pending expense, and the file with it', async () => {
      const id = await newExpense(adminA);
      await attachJpeg(adminA, id, 'p').expect(201);
      await attachJpeg(adminA, id, 'q').expect(201);
      const [first] = await receiptsOf(adminA, id);
      await http().delete(`/api/v1/expenses/${id}/receipts/${first.id}`).set(auth(adminA)).expect(204);
      expect(await receiptsOf(adminA, id)).toHaveLength(1);
      expect(disk.size).toBe(1);
      await http().get(`/api/v1/expenses/${id}/receipts/${first.id}/file`).set(auth(adminA)).expect(404);
    });

    it('frees a slot — after removing one, another can be added at the cap', async () => {
      const id = await newExpense(adminA);
      for (let i = 0; i < MAX_RECEIPTS_PER_EXPENSE; i++) await attachJpeg(adminA, id, String(i)).expect(201);
      const [first] = await receiptsOf(adminA, id);
      await http().delete(`/api/v1/expenses/${id}/receipts/${first.id}`).set(auth(adminA)).expect(204);
      await attachJpeg(adminA, id, 'n').expect(201);
    });

    it('keeps a paid expense\'s receipts — they are part of the record', async () => {
      const id = await newExpense(adminA);
      await attachJpeg(adminA, id).expect(201);
      await prisma.expense.update({ where: { id }, data: { status: 'PAID' } });
      const [r] = await receiptsOf(adminA, id);
      await http().delete(`/api/v1/expenses/${id}/receipts/${r.id}`).set(auth(adminA)).expect(403);
      expect(await receiptsOf(adminA, id)).toHaveLength(1);
      expect(disk.size).toBe(1);
      // …but a paid expense can still be given a receipt it was missing.
      await attachJpeg(adminA, id, 'late').expect(201);
    });

    it('takes the files off the server when a pending expense is deleted', async () => {
      const id = await newExpense(adminA);
      await attachJpeg(adminA, id, 'd').expect(201);
      await attachJpeg(adminA, id, 'e').expect(201);
      expect(disk.size).toBe(2);
      await http().delete(`/api/v1/expenses/${id}`).set(auth(adminA)).expect(200);
      expect(disk.size).toBe(0);
    });

    it('is a 404 for a receipt that belongs to a different expense', async () => {
      const one = await newExpense(adminA);
      const two = await newExpense(adminA);
      await attachJpeg(adminA, one).expect(201);
      const [r] = await receiptsOf(adminA, one);
      await http().delete(`/api/v1/expenses/${two}/receipts/${r.id}`).set(auth(adminA)).expect(404);
      await http().get(`/api/v1/expenses/${two}/receipts/${r.id}/file`).set(auth(adminA)).expect(404);
      expect(await receiptsOf(adminA, one)).toHaveLength(1);
    });
  });

  describe('who can reach receipts', () => {
    it('keeps residents and the committee out of the receipt routes', async () => {
      const id = await newExpense(adminA);
      await attachJpeg(adminA, id).expect(201);
      const [r] = await receiptsOf(adminA, id);
      for (const token of [residentA, committeeA]) {
        await attachJpeg(token, id).expect(403);
        await http().get(`/api/v1/expenses/${id}/receipts/${r.id}/file`).set(auth(token)).expect(403);
        await http().delete(`/api/v1/expenses/${id}/receipts/${r.id}`).set(auth(token)).expect(403);
      }
      expect(disk.size).toBe(1);
    });

    it('does not offer a receipt through the general documents routes — not even to the committee', async () => {
      const id = await newExpense(adminA);
      await attachJpeg(adminA, id).expect(201);
      const [r] = await receiptsOf(adminA, id);
      for (const token of [adminA, committeeA]) {
        const list = (await http().get('/api/v1/documents').set(auth(token)).expect(200)).body;
        const docs = (Array.isArray(list) ? list : list.data) as { id: string }[];
        expect(docs.find((d) => d.id === r.id)).toBeUndefined();
        await http().get(`/api/v1/documents/${r.id}`).set(auth(token)).expect(404);
        await http().get(`/api/v1/documents/${r.id}/file`).set(auth(token)).expect(404);
      }
    });

    it('does not hide ordinary documents that have no link — the filter only removes receipts', async () => {
      await http().post('/api/v1/documents').set(auth(adminA)).send({
        title: 'Bye-laws', fileName: 'bylaws.pdf', fileKey: 'https://example.com/bylaws.pdf', fileSize: 10, mimeType: 'application/pdf', accessLevel: 'RESIDENTS_ONLY',
      }).expect(201);
      const list = (await http().get('/api/v1/documents').set(auth(residentA)).expect(200)).body;
      const docs = (Array.isArray(list) ? list : list.data) as { title: string }[];
      expect(docs.some((d) => d.title === 'Bye-laws')).toBe(true);
    });

    it('keeps one society out of another\'s receipts', async () => {
      const id = await newExpense(adminA);
      await attachJpeg(adminA, id).expect(201);
      const [r] = await receiptsOf(adminA, id);
      await attachJpeg(adminB, id).expect(404);
      await http().get(`/api/v1/expenses/${id}/receipts/${r.id}/file`).set(auth(adminB)).expect(404);
      await http().delete(`/api/v1/expenses/${id}/receipts/${r.id}`).set(auth(adminB)).expect(404);

      // B's own expense, A's receipt id: still not reachable.
      const bExpense = await newExpense(adminB, 'B expense');
      await http().get(`/api/v1/expenses/${bExpense}/receipts/${r.id}/file`).set(auth(adminB)).expect(404);
      expect(disk.size).toBe(1);
    });
  });

  it('writes the receipt to the audit trail', async () => {
    const id = await newExpense(adminA);
    await attachJpeg(adminA, id).expect(201);
    const rows = await prisma.auditLog.findMany({ where: { societyId: societyA, entityId: id, action: 'EXPENSE_MODIFIED' } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].newValues)).toContain('receiptAdded');
  });
});
