/**
 * Correcting a posted expense, paying an expense out of a fund, and the bank-versus-funds summary —
 * against a REAL Postgres, through real HTTP.
 *
 * What a fake cannot prove: that correcting a paid expense's amount moves the account (and the fund) by
 * exactly the difference and writes a correcting ledger entry, that a refused correction leaves every
 * balance untouched, and that the corpus + other funds + the rest always add up to the bank.
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
const phone = (n: number) => '91' + String(UNIQUE).slice(-7) + String(n);
const D = (n: number | string) => new Prisma.Decimal(n);

describe('Expense corrections and funds (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let accountant: string;
  let resident: string;
  let societyId: string;
  let accountId: string;
  let corpusId: string;
  let festivalId: string;
  const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));

  async function makeUser(label: string, role: SystemRole): Promise<string> {
    const email = `${label}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: { email, firstName: label, lastName: 'Test', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, role, status: 'ACTIVE', isPrimary: false } });
    const login = await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200);
    return login.body.data.accessToken as string;
  }

  const accountBalance = async () => (await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalance.toFixed(2);
  const fundBalance = async (id: string) => (await prisma.fund.findUniqueOrThrow({ where: { id } })).currentBalance.toFixed(2);

  async function newExpense(amount: number, token = accountant) {
    const res = await http().post('/api/v1/expenses').set(auth(token)).send({
      description: `Repair ${amount}`, amount, category: 'Repairs', expenseDate: '2044-01-05',
    }).expect(201);
    return res.body.data.id as string;
  }
  const approve = (id: string) => http().post(`/api/v1/expenses/${id}/approve`).set(auth(admin)).expect(201);
  const pay = (id: string, body: Record<string, unknown> = { accountId }) => http().post(`/api/v1/expenses/${id}/mark-paid`).set(auth(admin)).send(body);
  const edit = (id: string, body: Record<string, unknown>, token = admin) => http().patch(`/api/v1/expenses/${id}`).set(auth(token)).send(body);
  const summary = async () => (await http().get('/api/v1/funds/summary').set(auth(admin)).expect(200)).body.data;
  async function paidExpense(amount: number, fundId?: string) {
    const id = await newExpense(amount);
    await approve(id);
    await pay(id, fundId ? { accountId, fundId } : { accountId }).expect(201);
    return id;
  }

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
      society: { name: `E2E Expenses ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-x-${UNIQUE}@test.example`, contactPhone: phone(1) },
      admin: { firstName: 'Admin', lastName: 'X', email: `admin-x-${UNIQUE}@test.example`, phone: phone(1), password: PASSWORD },
    }).expect(201);
    admin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    accountId = (await prisma.account.create({ data: { societyId, name: 'Main', accountType: 'CURRENT', currentBalance: D(100_000), openingBalance: D(100_000) } })).id;
    accountant = await makeUser('xacct', SystemRole.SOCIETY_ACCOUNTANT);
    resident = await makeUser('xres', SystemRole.RESIDENT);
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
  });

  /* ───────────────────────────── funds ───────────────────────────── */

  describe('fund kinds and the summary', () => {
    it('creates the corpus and another fund, and refuses a second corpus', async () => {
      const corpus = await http().post('/api/v1/funds').set(auth(admin)).send({ name: 'Corpus Fund', kind: 'CORPUS', openingBalance: 40000 }).expect(201);
      corpusId = corpus.body.data.id;
      expect(corpus.body.data.kind).toBe('CORPUS');

      const festival = await http().post('/api/v1/funds').set(auth(admin)).send({ name: 'Festival Fund', openingBalance: 10000 }).expect(201);
      festivalId = festival.body.data.id;
      expect(festival.body.data.kind).toBe('OTHER'); // the default

      const second = await http().post('/api/v1/funds').set(auth(admin)).send({ name: 'Corpus 2', kind: 'CORPUS' }).expect(409);
      expect(messageOf(second.body)).toMatch(/already has a corpus/);
      await http().post('/api/v1/funds').set(auth(admin)).send({ name: 'Bad', kind: 'WHATEVER' }).expect(400);
    });

    it('adds up: corpus + other funds + the rest = the bank', async () => {
      const s = await summary();
      expect(s.bankTotal).toBe('100000.00');
      expect(s.corpus.total).toBe('40000.00');
      expect(s.other.total).toBe('10000.00');
      expect(s.fundsTotal).toBe('50000.00');
      expect(s.generalBalance).toBe('50000.00');
      expect(s.fundsExceedBank).toBe(false);
      expect(s.adds).toBe(true);
      expect(s.other.funds.map((f: any) => f.name)).toEqual(['Festival Fund']);
      expect(s.corpus.funds.map((f: any) => f.id)).toEqual([corpusId]);
    });

    it('is for the admin and the accountant, not residents', async () => {
      await http().get('/api/v1/funds/summary').set(auth(accountant)).expect(200);
      await http().get('/api/v1/funds/summary').set(auth(resident)).expect(403);
    });

    it('says so when the funds claim more than the bank holds', async () => {
      await prisma.fund.update({ where: { id: festivalId }, data: { currentBalance: D(70_000) } });
      const s = await summary();
      expect(s.fundsExceedBank).toBe(true);
      expect(s.generalBalance).toBe('-10000.00');
      await prisma.fund.update({ where: { id: festivalId }, data: { currentBalance: D(10_000) } });
    });
  });

  /* ───────────────────────── correcting an expense ───────────────────────── */

  describe('correcting a posted expense', () => {
    it('lets a pending expense be fixed by the accountant with no comment', async () => {
      const id = await newExpense(900);
      const res = await edit(id, { amount: 950 }, accountant).expect(200);
      expect(res.body.data.amount).toBe('950');
      expect(res.body.data.correctedAt).toBeNull(); // not yet posted, so not a "correction"
    });

    it('keeps an approved or paid expense to the admin, and wants a comment', async () => {
      const id = await newExpense(1000);
      await approve(id);
      const noRight = await edit(id, { amount: 1100, reason: 'Typo' }, accountant).expect(403);
      expect(messageOf(noRight.body)).toMatch(/Only the society admin/);
      const noComment = await edit(id, { amount: 1100 }).expect(400);
      expect(messageOf(noComment.body)).toMatch(/comment/);
      await edit(id, { amount: 1100, reason: '  ' }).expect(400);
      expect((await prisma.expense.findUniqueOrThrow({ where: { id } })).amount.toString()).toBe('1000');
    });

    it('changes the amount of an approved expense without moving any money', async () => {
      const before = await accountBalance();
      const id = await newExpense(1000);
      await approve(id);
      const res = await edit(id, { amount: 1250, reason: 'Invoice was 1250, not 1000' }).expect(200);
      expect(res.body.data.amount).toBe('1250');
      expect(res.body.data.correctionNote).toBe('Invoice was 1250, not 1000');
      expect(res.body.data.correctedAt).not.toBeNull();
      expect(await accountBalance()).toBe(before);
    });

    it('moves the account by the difference when the amount of a PAID expense changes, with a ledger entry', async () => {
      const id = await paidExpense(2000);
      const afterPay = D(await accountBalance());

      await edit(id, { amount: 2500, reason: 'Vendor billed 2500' }).expect(200);
      expect(await accountBalance()).toBe(afterPay.minus(500).toFixed(2));
      const up = await prisma.transaction.findFirstOrThrow({
        where: { societyId, linkedEntityId: id, description: { startsWith: 'Correction' } },
      });
      expect(up.transactionType).toBe('DEBIT');
      expect(up.amount.toString()).toBe('500');
      expect(up.description).toContain('₹2000.00 → ₹2500.00');
      expect(up.description).toContain('Vendor billed 2500');

      await edit(id, { amount: 1800, reason: 'Credit note received' }).expect(200);
      expect(await accountBalance()).toBe(afterPay.plus(200).toFixed(2));
      const entries = await prisma.transaction.findMany({ where: { societyId, linkedEntityId: id }, orderBy: { createdAt: 'asc' } });
      // The original debit plus the two corrections net to what was finally spent.
      const net = entries.reduce((t, e) => (e.transactionType === 'DEBIT' ? t.plus(e.amount) : t.minus(e.amount)), D(0));
      expect(net.toFixed(2)).toBe('1800.00');
    });

    it('changes only the date, leaving the books alone', async () => {
      const id = await paidExpense(700);
      const before = await accountBalance();
      const txCount = await prisma.transaction.count({ where: { societyId } });
      const res = await edit(id, { expenseDate: '2044-02-09', reason: 'Date typed wrong' }).expect(200);
      expect(res.body.data.expenseDate).toContain('2044-02-09');
      expect(await accountBalance()).toBe(before);
      expect(await prisma.transaction.count({ where: { societyId } })).toBe(txCount);
    });

    it('refuses a change that changes nothing, and a bad amount, and a rejected expense', async () => {
      const id = await paidExpense(600);
      await edit(id, { amount: 600, reason: 'No real change' }).expect(400);
      await edit(id, { amount: 0, reason: 'Zero' }).expect(400);
      await edit(id, { amount: -5, reason: 'Negative' }).expect(400);
      await edit(id, { amount: 10.123, reason: 'Too precise' }).expect(400);
      await edit(id, { amount: 99_999_999_999, reason: 'Huge' }).expect(400);

      const rejected = await newExpense(300);
      await http().post(`/api/v1/expenses/${rejected}/reject`).set(auth(admin)).send({ reason: 'Duplicate' }).expect(201);
      await edit(rejected, { amount: 310, reason: 'Trying' }).expect(403);
    });

    it('will not move the account a paid expense came out of', async () => {
      const other = await prisma.account.create({ data: { societyId, name: 'Other', accountType: 'CASH', currentBalance: D(500) } });
      const id = await paidExpense(400);
      const res = await edit(id, { accountId: other.id, reason: 'Wrong account' }).expect(400);
      expect(messageOf(res.body)).toMatch(/cannot be changed/);
    });

    it('records who changed what, and why, in the history', async () => {
      const id = await paidExpense(1200);
      await edit(id, { amount: 1300, reason: 'First fix' }).expect(200);
      await edit(id, { expenseDate: '2044-03-01', description: 'Repair (corrected)', reason: 'Second fix' }).expect(200);
      const history = (await http().get(`/api/v1/expenses/${id}/history`).set(auth(admin)).expect(200)).body.data;
      expect(history).toHaveLength(2);
      expect(history[0].reason).toBe('Second fix'); // newest first
      expect(history[0].changes.expenseDate).toBeDefined();
      expect(history[0].changes.description.to).toBe('Repair (corrected)');
      expect(history[1].changes.amount).toEqual({ from: '1200.00', to: '1300.00' });
      expect(history[1].by).toContain('Admin');
    });
  });

  /* ───────────────────────── paying out of a fund ───────────────────────── */

  describe('paying an expense out of a fund', () => {
    it('lowers the fund and the bank together, so the picture still adds up', async () => {
      const bank = D(await accountBalance());
      const fund = D(await fundBalance(festivalId));
      const general = D((await summary()).generalBalance);

      const id = await paidExpense(3000, festivalId);

      expect(await accountBalance()).toBe(bank.minus(3000).toFixed(2));
      expect(await fundBalance(festivalId)).toBe(fund.minus(3000).toFixed(2));
      const expense = await prisma.expense.findUniqueOrThrow({ where: { id } });
      expect(expense.fundId).toBe(festivalId);
      const tx = await prisma.transaction.findFirstOrThrow({ where: { societyId, linkedEntityId: id } });
      expect(tx.fundId).toBe(festivalId);

      const s = await summary();
      expect(s.adds).toBe(true);
      // The rest is unchanged: the money came out of the earmark, not out of maintenance money.
      expect(s.generalBalance).toBe(general.toFixed(2));
    });

    it('refuses when the fund holds less than the expense, and changes nothing', async () => {
      const bank = await accountBalance();
      const fund = await fundBalance(festivalId);
      const id = await newExpense(900_000);
      await approve(id);
      const res = await pay(id, { accountId, fundId: festivalId }).expect(400);
      expect(messageOf(res.body)).toMatch(/holds only/);
      expect(await accountBalance()).toBe(bank);
      expect(await fundBalance(festivalId)).toBe(fund);
      expect((await prisma.expense.findUniqueOrThrow({ where: { id } })).status).toBe('APPROVED');
    });

    it('will not take from a fund in another society', async () => {
      const foreign = await prisma.society.create({ data: { name: `Elsewhere ${UNIQUE}`, address: 'x', city: 'x', state: 'x', pincode: '600001', country: 'India' } });
      const foreignFund = await prisma.fund.create({ data: { societyId: foreign.id, name: 'Theirs', currentBalance: D(1000) } });
      const id = await newExpense(100);
      await approve(id);
      await pay(id, { accountId, fundId: foreignFund.id }).expect(404);
      expect(await fundBalance(foreignFund.id)).toBe('1000.00');
      await prisma.fund.delete({ where: { id: foreignFund.id } });
      await prisma.society.delete({ where: { id: foreign.id } });
    });

    it('moves the fund as well when the amount of a fund-paid expense is corrected', async () => {
      const id = await paidExpense(1000, festivalId);
      const bank = D(await accountBalance());
      const fund = D(await fundBalance(festivalId));

      await edit(id, { amount: 1400, reason: 'Final bill higher' }).expect(200);
      expect(await accountBalance()).toBe(bank.minus(400).toFixed(2));
      expect(await fundBalance(festivalId)).toBe(fund.minus(400).toFixed(2));

      await edit(id, { amount: 900, reason: 'Discount given' }).expect(200);
      // 1000 -> 1400 -> 900 nets to 100 less than the 1000 originally taken.
      expect(await accountBalance()).toBe(bank.plus(100).toFixed(2));
      expect(await fundBalance(festivalId)).toBe(fund.plus(100).toFixed(2));
      expect((await summary()).adds).toBe(true);
    });

    it('refuses a correction the fund cannot cover, and rolls everything back', async () => {
      const id = await paidExpense(500, festivalId);
      const bank = await accountBalance();
      const fund = await fundBalance(festivalId);
      const ledger = await prisma.transaction.count({ where: { societyId } });
      const res = await edit(id, { amount: 500_000, reason: 'Way up' }).expect(400);
      expect(messageOf(res.body)).toMatch(/does not hold enough/);
      expect(await accountBalance()).toBe(bank);
      expect(await fundBalance(festivalId)).toBe(fund);
      expect(await prisma.transaction.count({ where: { societyId } })).toBe(ledger);
      expect((await prisma.expense.findUniqueOrThrow({ where: { id } })).amount.toString()).toBe('500');
    });

    it('keeps the books adding up after all of it', async () => {
      const s = await summary();
      expect(s.adds).toBe(true);
      expect(D(s.bankTotal).minus(D(s.fundsTotal)).toFixed(2)).toBe(s.generalBalance);
      // The bank total is every active account, not just the main one.
      const all = await prisma.account.aggregate({ where: { societyId, isActive: true }, _sum: { currentBalance: true } });
      expect(s.bankTotal).toBe(all._sum.currentBalance!.toFixed(2));
    });
  });
});
