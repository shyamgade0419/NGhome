/**
 * Deleting a bank account entered by mistake — against a REAL Postgres, through real HTTP.
 *
 * What a fake cannot prove: an unused account really is deleted (the live database has NO ACTION foreign keys,
 * so a stray reference would make the delete fail), one that has been used is only taken off the lists and out
 * of the totals with its history intact, and a removed account cannot take new money.
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

jest.setTimeout(90_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const phone = (n: number) => '92' + String(UNIQUE).slice(-7) + String(n);

describe('Deleting an account (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let accountant: string;
  let societyId: string;
  const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));

  const makeAccount = async (name: string, openingBalance: number) =>
    (await http().post('/api/v1/accounts').set(auth(admin)).send({ name, accountType: 'CURRENT', openingBalance }).expect(201)).body.data.id as string;
  const remove = (id: string, token = admin) => http().delete(`/api/v1/accounts/${id}`).set(auth(token));
  const listed = async () => ((await http().get('/api/v1/accounts').set(auth(admin)).expect(200)).body.data as any[]).map((a) => a.id);

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
      society: { name: `E2E Accounts ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-a-${UNIQUE}@test.example`, contactPhone: phone(1) },
      admin: { firstName: 'Admin', lastName: 'A', email: `admin-a-${UNIQUE}@test.example`, phone: phone(1), password: PASSWORD },
    }).expect(201);
    admin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;

    const email = `acct-a-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: { email, firstName: 'Acct', lastName: 'Test', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, role: SystemRole.SOCIETY_ACCOUNTANT, status: 'ACTIVE', isPrimary: false } });
    accountant = (await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200)).body.data.accessToken;
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
  });

  it('deletes an account nothing has used, and the bank total falls with it', async () => {
    const keep = await makeAccount('Kept', 5000);
    const mistake = await makeAccount('Wrong amount', 99999);

    const res = await remove(mistake).expect(200);
    expect(res.body.data).toMatchObject({ id: mistake, deleted: true, removedFromLists: false });

    expect(await prisma.account.findUnique({ where: { id: mistake } })).toBeNull();
    expect(await listed()).toEqual([keep]);
    expect((await http().get('/api/v1/funds/summary').set(auth(admin)).expect(200)).body.data.bankTotal).toBe('5000.00');

    const audit = await prisma.auditLog.findFirst({ where: { societyId, entityType: 'Account', entityId: mistake } });
    expect(audit?.action).toBe('CONFIG_CHANGED');
    expect(audit?.oldValues).toMatchObject({ name: 'Wrong amount', openingBalance: '99999' });
  });

  it('lets a fund that pointed at the account live on without it', async () => {
    const acct = await makeAccount('Fund home', 1000);
    const fund = (await http().post('/api/v1/funds').set(auth(admin)).send({ name: 'Tied fund', accountId: acct, openingBalance: 300 }).expect(201)).body.data.id;

    await remove(acct).expect(200);

    const after = await prisma.fund.findUniqueOrThrow({ where: { id: fund } });
    expect(after.accountId).toBeNull();
    expect(after.currentBalance.toFixed(2)).toBe('300.00');
  });

  it('only takes a used account off the lists, keeping its history', async () => {
    const acct = await makeAccount('Used', 20000);
    const expense = (await http().post('/api/v1/expenses').set(auth(accountant)).send({ description: 'Pump repair', amount: 1500, category: 'Repairs', expenseDate: '2044-02-01' }).expect(201)).body.data.id;
    await http().post(`/api/v1/expenses/${expense}/approve`).set(auth(admin)).expect(201);
    await http().post(`/api/v1/expenses/${expense}/mark-paid`).set(auth(admin)).send({ accountId: acct }).expect(201);

    const res = await remove(acct).expect(200);
    expect(res.body.data).toMatchObject({ deleted: false, removedFromLists: true, expenses: 1 });
    expect(res.body.data.transactions).toBeGreaterThan(0);

    const row = await prisma.account.findUniqueOrThrow({ where: { id: acct } });
    expect(row.isActive).toBe(false);
    expect(await prisma.transaction.count({ where: { accountId: acct } })).toBeGreaterThan(0);
    expect(await prisma.expense.findUniqueOrThrow({ where: { id: expense } })).toMatchObject({ accountId: acct, status: 'PAID' });
    expect(await listed()).not.toContain(acct);
  });

  it('stops a removed account taking new money', async () => {
    const gone = await makeAccount('Soon gone', 100);
    const first = (await http().post('/api/v1/expenses').set(auth(accountant)).send({ description: 'First', amount: 10, category: 'Repairs', expenseDate: '2044-02-02' }).expect(201)).body.data.id;
    await http().post(`/api/v1/expenses/${first}/approve`).set(auth(admin)).expect(201);
    await http().post(`/api/v1/expenses/${first}/mark-paid`).set(auth(admin)).send({ accountId: gone }).expect(201);
    await remove(gone).expect(200); // used, so hidden rather than deleted

    const second = (await http().post('/api/v1/expenses').set(auth(accountant)).send({ description: 'Second', amount: 20, category: 'Repairs', expenseDate: '2044-02-03' }).expect(201)).body.data.id;
    await http().post(`/api/v1/expenses/${second}/approve`).set(auth(admin)).expect(201);
    const paid = await http().post(`/api/v1/expenses/${second}/mark-paid`).set(auth(admin)).send({ accountId: gone });
    expect(paid.status).toBe(404);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: second } })).status).toBe('APPROVED');
    expect((await prisma.account.findUniqueOrThrow({ where: { id: gone } })).currentBalance.toFixed(2)).toBe('90.00');
  });

  it('is for the admin only, and only for this society', async () => {
    const acct = await makeAccount('Guarded', 1);
    await remove(acct, accountant).expect(403);
    await http().delete(`/api/v1/accounts/${acct}`).expect(401);
    expect(await prisma.account.findUnique({ where: { id: acct } })).not.toBeNull();

    const outsider = await http().post('/api/v1/auth/register-society').send({
      society: { name: `E2E Other ${UNIQUE}`, address: '2 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-b-${UNIQUE}@test.example`, contactPhone: phone(2) },
      admin: { firstName: 'Admin', lastName: 'B', email: `admin-b-${UNIQUE}@test.example`, phone: phone(2), password: PASSWORD },
    }).expect(201);
    const res = await remove(acct, outsider.body.data.accessToken).expect(404);
    expect(messageOf(res.body)).toMatch(/not found/i);
    expect(await prisma.account.findUnique({ where: { id: acct } })).not.toBeNull();
    await prisma.society.update({ where: { id: outsider.body.data.memberships[0].societyId }, data: { deletedAt: new Date() } });
  });
});
