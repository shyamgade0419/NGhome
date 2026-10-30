/**
 * Owners and tenants, against a REAL Postgres, through real HTTP.
 *
 * A tenant sees regular maintenance, their bills and the expenses — but never the corpus fund or the bank
 * balances, whatever the society has switched on for residents. The rule is decided on the server from the
 * caller's own membership, so these tests look at what the API sends, not at what a screen hides.
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

jest.setTimeout(60_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const phone = (n: number) => '88' + String(UNIQUE).slice(-7) + String(n);

describe('Owners and tenants (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let societyId: string;
  let buildingId: string;
  let adminB: string;
  let societyB: string;
  let flatNo = 0;

  const newFlat = async () => {
    flatNo += 1;
    return (await http().post('/api/v1/flats').set(auth(admin)).send({ buildingId, unitNumber: `${flatNo}`, flatCode: `T-${flatNo}` }).expect(201)).body.data.id as string;
  };

  async function makeUser(label: string, role: SystemRole, flatId: string | null, soc = societyId): Promise<{ token: string; userId: string }> {
    const email = `${label}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: { email, firstName: label, lastName: 'Test', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId: soc, userId: user.id, flatId, role, status: 'ACTIVE', isPrimary: role === SystemRole.RESIDENT } });
    const login = await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200);
    return { token: login.body.data.accessToken as string, userId: user.id };
  }

  const funds = (t: string) => http().get('/api/v1/funds').set(auth(t));
  const summary = (t: string) => http().get('/api/v1/societies/my/financial-summary').set(auth(t));
  const setResidency = (t: string, userId: string, body: Record<string, unknown>) =>
    http().patch(`/api/v1/users/society/${userId}/residency`).set(auth(t)).send(body);

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

    const register = async (tag: string, ph: string) =>
      http().post('/api/v1/auth/register-society').send({
        society: { name: `E2E Residency ${tag} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-${tag}-${UNIQUE}@test.example`, contactPhone: ph },
        admin: { firstName: 'Admin', lastName: tag, email: `admin-${tag}-${UNIQUE}@test.example`, phone: ph, password: PASSWORD },
      }).expect(201);
    const a = await register('ra', phone(1));
    admin = a.body.data.accessToken;
    societyId = a.body.data.memberships[0].societyId;
    const b = await register('rb', phone(2));
    adminB = b.body.data.accessToken;
    societyB = b.body.data.memberships[0].societyId;
    buildingId = (await http().post('/api/v1/buildings').set(auth(admin)).send({ name: 'T', code: 'T' }).expect(201)).body.data.id;

    // The society has a corpus fund the residents are allowed to see, a bank account, and shows both to residents.
    await http().post('/api/v1/funds').set(auth(admin)).send({ name: 'Corpus Fund', openingBalance: 500000, isVisibleToResidents: true }).expect(201);
    await prisma.account.create({ data: { societyId, name: 'SBI Current', accountType: 'CURRENT', currentBalance: 750000 } });
    await prisma.societyConfiguration.update({ where: { societyId }, data: { showAccountBalancesToResidents: true, showExpensesToResidents: true } });
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    if (societyB) await prisma.society.update({ where: { id: societyB }, data: { deletedAt: new Date() } });
    await app.close();
  });

  describe('an owner', () => {
    it('is the default, and sees the corpus and the bank balance the society has chosen to show', async () => {
      const r = await makeUser('owner1', SystemRole.RESIDENT, await newFlat());
      expect((await prisma.societyMembership.findFirstOrThrow({ where: { userId: r.userId } })).residencyType).toBe('OWNER');
      const f = (await funds(r.token).expect(200)).body.data as { name: string }[];
      expect(f.map((x) => x.name)).toContain('Corpus Fund');
      const s = (await summary(r.token).expect(200)).body.data;
      expect(s.showBalances).toBe(true);
      expect(s.totalBalance).toBe(750000);
      expect(s.ownersOnlyHidden).toBe(false);
    });
  });

  describe('a tenant', () => {
    it('is sent no funds at all, and cannot open one by its id', async () => {
      const r = await makeUser('tenant1', SystemRole.RESIDENT, await newFlat());
      await setResidency(admin, r.userId, { residencyType: 'TENANT' }).expect(200);
      expect((await funds(r.token).expect(200)).body.data).toEqual([]);
      const fundId = (await prisma.fund.findFirstOrThrow({ where: { societyId } })).id;
      await http().get(`/api/v1/funds/${fundId}`).set(auth(r.token)).expect(404);
    });

    it('is sent no bank balance, but still sees the expenses', async () => {
      const r = await makeUser('tenant2', SystemRole.RESIDENT, await newFlat());
      await setResidency(admin, r.userId, { residencyType: 'TENANT' }).expect(200);
      await prisma.expense.create({ data: { societyId, description: 'Lift repair', amount: '2000', expenseDate: new Date(), status: 'PAID', createdById: r.userId } });
      const s = (await summary(r.token).expect(200)).body.data;
      expect(s.showBalances).toBe(false);
      expect(s.totalBalance).toBeNull();
      expect(s.ownersOnlyHidden).toBe(true);
      expect(s.showExpenses).toBe(true);
      expect(s.monthlyExpenses).toBeGreaterThanOrEqual(2000);
      expect(JSON.stringify(s)).not.toContain('750000');
    });

    it('is held back the moment they are marked, with the same login — no new token needed', async () => {
      const r = await makeUser('tenant3', SystemRole.RESIDENT, await newFlat());
      expect((await funds(r.token).expect(200)).body.data.length).toBeGreaterThan(0);
      await setResidency(admin, r.userId, { residencyType: 'TENANT' }).expect(200);
      expect((await funds(r.token).expect(200)).body.data).toEqual([]);
      await setResidency(admin, r.userId, { residencyType: 'OWNER' }).expect(200);
      expect((await funds(r.token).expect(200)).body.data.length).toBeGreaterThan(0);
    });

    it('still sees their own bills', async () => {
      const r = await makeUser('tenant4', SystemRole.RESIDENT, await newFlat());
      await setResidency(admin, r.userId, { residencyType: 'TENANT' }).expect(200);
      await http().get('/api/v1/billing/my-bills').set(auth(r.token)).expect(200);
    });
  });

  describe('everyone else is unaffected', () => {
    it('the admin, accountant and committee see the funds as before', async () => {
      const accountant = await makeUser('acct', SystemRole.SOCIETY_ACCOUNTANT, null);
      const committee = await makeUser('comm', SystemRole.COMMITTEE_MEMBER, null);
      for (const t of [admin, accountant.token, committee.token]) {
        expect((await funds(t).expect(200)).body.data.length).toBeGreaterThan(0);
      }
    });
  });

  describe('setting it', () => {
    it('is the admin\'s alone', async () => {
      const r = await makeUser('plain', SystemRole.RESIDENT, await newFlat());
      const other = await makeUser('other', SystemRole.RESIDENT, await newFlat());
      await setResidency(r.token, other.userId, { residencyType: 'TENANT' }).expect(403);
      await setResidency(r.token, r.userId, { residencyType: 'TENANT' }).expect(403); // not even their own
      expect((await prisma.societyMembership.findFirstOrThrow({ where: { userId: r.userId } })).residencyType).toBe('OWNER');
    });

    it('refuses anything but owner or tenant', async () => {
      const r = await makeUser('bad', SystemRole.RESIDENT, await newFlat());
      await setResidency(admin, r.userId, { residencyType: 'LANDLORD' }).expect(400);
      await setResidency(admin, r.userId, {}).expect(400);
    });

    it('does not reach another society\'s resident', async () => {
      const r = await makeUser('theirs', SystemRole.RESIDENT, null, societyB);
      await setResidency(admin, r.userId, { residencyType: 'TENANT' }).expect(404);
      expect((await prisma.societyMembership.findFirstOrThrow({ where: { userId: r.userId } })).residencyType).toBe('OWNER');
    });

    it('writes to the audit trail', async () => {
      const r = await makeUser('audited', SystemRole.RESIDENT, await newFlat());
      await setResidency(admin, r.userId, { residencyType: 'TENANT' }).expect(200);
      const rows = await prisma.auditLog.findMany({ where: { societyId, entityType: 'SocietyMembership', action: 'USER_MODIFIED' } });
      expect(JSON.stringify(rows.map((x) => x.newValues))).toContain('RESIDENCY_CHANGED');
    });

    it('needs the flat named when a person is in two flats', async () => {
      const f1 = await newFlat();
      const f2 = await newFlat();
      const r = await makeUser('twoflats', SystemRole.RESIDENT, f1);
      await prisma.societyMembership.create({ data: { societyId, userId: r.userId, flatId: f2, role: SystemRole.RESIDENT, status: 'ACTIVE' } });
      await setResidency(admin, r.userId, { residencyType: 'TENANT' }).expect(409);
      await setResidency(admin, r.userId, { residencyType: 'TENANT', flatId: f2 }).expect(200);
      const rows = await prisma.societyMembership.findMany({ where: { userId: r.userId }, orderBy: { createdAt: 'asc' } });
      expect(rows.map((x) => x.residencyType)).toEqual(['OWNER', 'TENANT']);
    });

    it('is not reset when the admin changes the person\'s role — a tenant promoted to committee stays a tenant', async () => {
      const r = await makeUser('promoted', SystemRole.RESIDENT, await newFlat());
      await setResidency(admin, r.userId, { residencyType: 'TENANT' }).expect(200);
      await http().post('/api/v1/users/society/add-member').set(auth(admin)).send({ userId: r.userId, role: 'COMMITTEE_MEMBER' }).expect(201);
      const m = await prisma.societyMembership.findFirstOrThrow({ where: { userId: r.userId, societyId } });
      expect(m.role).toBe('COMMITTEE_MEMBER');
      expect(m.residencyType).toBe('TENANT');
    });

    it('shows on the residents list', async () => {
      const r = await makeUser('listed', SystemRole.RESIDENT, await newFlat());
      await setResidency(admin, r.userId, { residencyType: 'TENANT' }).expect(200);
      const list = (await http().get('/api/v1/users/society?limit=100').set(auth(admin)).expect(200)).body.data as { id: string; memberships: { residencyType: string }[] }[];
      expect(list.find((u) => u.id === r.userId)!.memberships[0].residencyType).toBe('TENANT');
    });
  });

  describe('joining', () => {
    it('records whether a new resident says they own or rent', async () => {
      const code = 'RT' + String(UNIQUE).slice(-6);
      await prisma.society.update({ where: { id: societyId }, data: { joinCode: code } });
      const flat = await newFlat();
      const email = `joiner-${UNIQUE}@test.example`;
      await http().post('/api/v1/auth/join-society').send({
        joinCode: code, flatId: flat, firstName: 'Jo', lastName: 'Iner', email, phone: '+9198' + String(UNIQUE).slice(-8), password: PASSWORD, residencyType: 'TENANT',
      }).expect(201);
      const m = await prisma.societyMembership.findFirstOrThrow({ where: { flatId: flat } });
      expect(m.residencyType).toBe('TENANT');
    });
  });
});
