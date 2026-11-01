/**
 * Raising and lowering a fund by hand (with a comment), the fund history, and choosing the fund an expense is
 * spent from when it is posted — against a REAL Postgres, through real HTTP.
 *
 * What a fake cannot prove: the fund moves by exactly the amount and never below zero, the bank moves only
 * when it is asked to, every entry keeps its comment, and through all of it corpus + other funds + the rest
 * still equals the bank.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Prisma, SystemRole } from '@prisma/client';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(90_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const phone = (n: number) => '93' + String(UNIQUE).slice(-7) + String(n);
const D = (n: number | string) => new Prisma.Decimal(n);

describe('Adjusting funds (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let accountant: string;
  let societyId: string;
  let accountId: string;
  let corpusId: string;
  let ganeshId: string;
  const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));

  const bank = async () => (await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalance.toFixed(2);
  const fund = async (id: string) => (await prisma.fund.findUniqueOrThrow({ where: { id } })).currentBalance.toFixed(2);
  const summary = async () => (await http().get('/api/v1/funds/summary').set(auth(admin)).expect(200)).body.data;
  const adjust = (id: string, body: Record<string, unknown>, token = admin) => http().post(`/api/v1/funds/${id}/adjust`).set(auth(token)).send(body);
  const history = async (id: string) => (await http().get(`/api/v1/funds/${id}/history`).set(auth(admin)).expect(200)).body.data;
  const addsUp = async () => {
    const s = await summary();
    expect(D(s.corpus.total).plus(s.other.total).plus(s.generalBalance).toFixed(2)).toBe(D(s.bankTotal).toFixed(2));
    return s;
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
      society: { name: `E2E Fund Adjust ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-f-${UNIQUE}@test.example`, contactPhone: phone(1) },
      admin: { firstName: 'Admin', lastName: 'F', email: `admin-f-${UNIQUE}@test.example`, phone: phone(1), password: PASSWORD },
    }).expect(201);
    admin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    accountId = (await prisma.account.create({ data: { societyId, name: 'Main', accountType: 'CURRENT', currentBalance: D(100_000), openingBalance: D(100_000) } })).id;

    const email = `acct-f-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: { email, firstName: 'Acct', lastName: 'Test', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, role: SystemRole.SOCIETY_ACCOUNTANT, status: 'ACTIVE', isPrimary: false } });
    accountant = (await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200)).body.data.accessToken;

    corpusId = (await http().post('/api/v1/funds').set(auth(admin)).send({ name: 'Corpus Fund', kind: 'CORPUS', openingBalance: 40000 }).expect(201)).body.data.id;
    ganeshId = (await http().post('/api/v1/funds').set(auth(admin)).send({ name: 'Ganesh Fund', openingBalance: 10000 }).expect(201)).body.data.id;
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
  });

  describe('raising a fund', () => {
    it('moves only the earmark by default: the general money falls, the bank does not', async () => {
      const before = await summary();
      const res = await adjust(ganeshId, { direction: 'INCREASE', amount: 2500.5, comment: 'Donations for the festival' }).expect(201);
      expect(D(res.body.data.currentBalance).toFixed(2)).toBe('12500.50');

      expect(await bank()).toBe('100000.00');
      const after = await addsUp();
      expect(D(after.generalBalance).toFixed(2)).toBe(D(before.generalBalance).minus('2500.50').toFixed(2));
    });

    it('moves the bank too when the money really arrived there', async () => {
      await adjust(ganeshId, { direction: 'INCREASE', amount: 1000, comment: 'Cash donation banked', accountId }).expect(201);
      expect(await fund(ganeshId)).toBe('13500.50');
      expect(await bank()).toBe('101000.00');
      await addsUp();
    });

    it('is open to the accountant', async () => {
      await adjust(ganeshId, { direction: 'INCREASE', amount: 100, comment: 'Small donation' }, accountant).expect(201);
      expect(await fund(ganeshId)).toBe('13600.50');
    });
  });

  describe('lowering a fund', () => {
    it('takes it down by the amount and keeps everything adding up', async () => {
      const res = await adjust(corpusId, { direction: 'DECREASE', amount: 5000, comment: 'Entered twice by mistake' }).expect(201);
      expect(D(res.body.data.currentBalance).toFixed(2)).toBe('35000.00');
      expect(await bank()).toBe('101000.00');
      await addsUp();
    });

    it('takes the bank down too when the money really left it', async () => {
      await adjust(corpusId, { direction: 'DECREASE', amount: 1000, comment: 'Paid out for the lift deposit', accountId }).expect(201);
      expect(await fund(corpusId)).toBe('34000.00');
      expect(await bank()).toBe('100000.00');
      await addsUp();
    });

    it('is for the admin only', async () => {
      const res = await adjust(corpusId, { direction: 'DECREASE', amount: 1, comment: 'Not allowed' }, accountant).expect(403);
      expect(messageOf(res.body)).toMatch(/Only the admin/);
      expect(await fund(corpusId)).toBe('34000.00');
    });

    it('never takes a fund below zero, and changes nothing when it refuses', async () => {
      const res = await adjust(ganeshId, { direction: 'DECREASE', amount: 999999, comment: 'Too much', accountId }).expect(400);
      expect(messageOf(res.body)).toMatch(/holds only/);
      expect(await fund(ganeshId)).toBe('13600.50');
      expect(await bank()).toBe('100000.00');
    });
  });

  describe('what is refused', () => {
    it('needs a comment of at least three characters', async () => {
      await adjust(ganeshId, { direction: 'INCREASE', amount: 10 }).expect(400);
      await adjust(ganeshId, { direction: 'INCREASE', amount: 10, comment: '  ' }).expect(400);
      await adjust(ganeshId, { direction: 'INCREASE', amount: 10, comment: 'ab' }).expect(400);
      expect(await fund(ganeshId)).toBe('13600.50');
    });

    it('needs a positive amount with at most two decimals, and a real direction', async () => {
      await adjust(ganeshId, { direction: 'INCREASE', amount: 0, comment: 'Zero' }).expect(400);
      await adjust(ganeshId, { direction: 'INCREASE', amount: -5, comment: 'Negative' }).expect(400);
      await adjust(ganeshId, { direction: 'INCREASE', amount: 1.234, comment: 'Three places' }).expect(400);
      await adjust(ganeshId, { direction: 'SIDEWAYS', amount: 5, comment: 'Nowhere' }).expect(400);
      expect(await fund(ganeshId)).toBe('13600.50');
    });

    it('will not touch a fund or an account from another society', async () => {
      const other = await http().post('/api/v1/auth/register-society').send({
        society: { name: `E2E Fund Other ${UNIQUE}`, address: '2 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-g-${UNIQUE}@test.example`, contactPhone: phone(2) },
        admin: { firstName: 'Admin', lastName: 'G', email: `admin-g-${UNIQUE}@test.example`, phone: phone(2), password: PASSWORD },
      }).expect(201);
      const outsider = other.body.data.accessToken;
      await adjust(ganeshId, { direction: 'INCREASE', amount: 5, comment: 'Not yours' }, outsider).expect(404);
      await adjust(ganeshId, { direction: 'INCREASE', amount: 5, comment: 'Foreign account', accountId: 'does-not-exist' }).expect(404);
      await http().get(`/api/v1/funds/${ganeshId}/history`).set(auth(outsider)).expect(404);
      expect(await fund(ganeshId)).toBe('13600.50');
      await prisma.society.update({ where: { id: other.body.data.memberships[0].societyId }, data: { deletedAt: new Date() } });
    });
  });

  describe('the history', () => {
    it('lists every entry newest first with its comment, who made it, and whether the bank moved', async () => {
      const h = await history(ganeshId);
      expect(h.fund).toMatchObject({ name: 'Ganesh Fund', openingBalance: '10000.00', currentBalance: '13600.50' });
      expect(h.entries.map((e: any) => e.description)).toEqual([
        'Added to Ganesh Fund: Small donation',
        'Added to Ganesh Fund: Cash donation banked',
        'Added to Ganesh Fund: Donations for the festival',
      ]);
      expect(h.entries[0]).toMatchObject({ direction: 'IN', amount: '100.00', movedBankAccount: false });
      expect(h.entries[0].by).toBe('Acct Test');
      expect(h.entries[1]).toMatchObject({ amount: '1000.00', movedBankAccount: true });
    });

    it('writes each hand adjustment to the audit log with the comment', async () => {
      const row = await prisma.auditLog.findFirst({
        where: { societyId, entityType: 'Fund', entityId: corpusId, action: 'FUND_TRANSACTION' },
        orderBy: { createdAt: 'asc' },
      });
      expect(row?.newValues).toMatchObject({ type: 'DECREASE', comment: 'Entered twice by mistake', balanceAfter: '35000' });
    });
  });

  describe('choosing the fund when the expense is posted', () => {
    const post = async (amount: number, extra: Record<string, unknown> = {}) =>
      (await http().post('/api/v1/expenses').set(auth(accountant)).send({ description: `Spend ${amount}`, amount, category: 'Repairs', expenseDate: '2044-03-01', ...extra }).expect(201)).body.data.id as string;
    const approve = (id: string) => http().post(`/api/v1/expenses/${id}/approve`).set(auth(admin)).expect(201);

    it('moves nothing when posted, then takes the fund down when paid', async () => {
      const before = await fund(ganeshId);
      const id = await post(600, { fundId: ganeshId });
      await approve(id);
      expect(await fund(ganeshId)).toBe(before);

      await http().post(`/api/v1/expenses/${id}/mark-paid`).set(auth(admin)).send({ accountId }).expect(201);
      expect(await fund(ganeshId)).toBe(D(before).minus(600).toFixed(2));
      expect((await prisma.expense.findUniqueOrThrow({ where: { id } })).fundId).toBe(ganeshId);
      await addsUp();

      const h = await history(ganeshId);
      expect(h.entries[0]).toMatchObject({ direction: 'OUT', amount: '600.00', description: 'Expense: Spend 600', movedBankAccount: true });
    });

    it('lets the person paying choose no fund after all', async () => {
      const before = await fund(ganeshId);
      const id = await post(50, { fundId: ganeshId });
      await approve(id);
      await http().post(`/api/v1/expenses/${id}/mark-paid`).set(auth(admin)).send({ accountId, fundId: null }).expect(201);
      expect(await fund(ganeshId)).toBe(before);
      expect((await prisma.expense.findUniqueOrThrow({ where: { id } })).fundId).toBeNull();
    });

    it('lets the person paying choose a different fund', async () => {
      const ganeshBefore = await fund(ganeshId);
      const corpusBefore = await fund(corpusId);
      const id = await post(70, { fundId: ganeshId });
      await approve(id);
      await http().post(`/api/v1/expenses/${id}/mark-paid`).set(auth(admin)).send({ accountId, fundId: corpusId }).expect(201);
      expect(await fund(ganeshId)).toBe(ganeshBefore);
      expect(await fund(corpusId)).toBe(D(corpusBefore).minus(70).toFixed(2));
    });

    it('is paid from the general money when no fund was chosen', async () => {
      const before = await summary();
      const id = await post(40);
      await approve(id);
      await http().post(`/api/v1/expenses/${id}/mark-paid`).set(auth(admin)).send({ accountId }).expect(201);
      const after = await addsUp();
      expect(after.fundsTotal).toBe(before.fundsTotal);
    });

    it('refuses a fund from another society', async () => {
      const res = await http().post('/api/v1/expenses').set(auth(accountant)).send({ description: 'Bad fund', amount: 5, category: 'Repairs', expenseDate: '2044-03-02', fundId: 'not-a-fund' }).expect(404);
      expect(messageOf(res.body)).toMatch(/Fund not found/);
    });

    it('stops the payment, leaving it approved, when the chosen fund cannot cover it', async () => {
      const id = await post(5_000_000, { fundId: ganeshId });
      await approve(id);
      const res = await http().post(`/api/v1/expenses/${id}/mark-paid`).set(auth(admin)).send({ accountId }).expect(400);
      expect(messageOf(res.body)).toMatch(/holds only/);
      expect((await prisma.expense.findUniqueOrThrow({ where: { id } })).status).toBe('APPROVED');
    });
  });
});
