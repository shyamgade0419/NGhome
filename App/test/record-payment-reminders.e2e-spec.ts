/**
 * An admin recording that a flat has paid, and reminding the flats that have not — against a REAL Postgres.
 *
 * What a fake cannot prove: the bill really settles (oldest month first), the money lands in the chosen account
 * and its ledger, a retry cannot pay twice, and the reminder goes to the tenant when a flat has one and to the
 * owner when it does not.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Prisma, ResidencyType, SystemRole } from '@prisma/client';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(90_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const phone = (n: number) => '93' + String(UNIQUE).slice(-7) + String(n);
/** A phone number that is different on every run, so a database that kept an earlier run's users does not collide. */
const uniquePhone = (n: number) => '7' + String(UNIQUE).slice(-8) + n;
const D = (n: number | string) => new Prisma.Decimal(n);

describe('Recording a payment and sending reminders (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let resident: string;
  let societyId: string;
  let buildingId: string;
  let accountId: string;
  let flatNo = 0;
  let monthNo = 0;
  let invNo = 0;
  let personNo = 0;

  const messageOf = (body: any) => String(body?.message ?? body?.error?.message ?? JSON.stringify(body));

  async function addPerson(flatId: string | null, role: SystemRole, residencyType: ResidencyType, over: { isPrimary?: boolean; phone?: string | null } = {}) {
    personNo += 1;
    const email = `p${personNo}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: {
        email, firstName: `${residencyType === 'TENANT' ? 'Tenant' : 'Owner'}${personNo}`, lastName: 'Test',
        phone: over.phone === undefined ? phone(10 + personNo) : over.phone,
        passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true,
      },
    });
    await prisma.societyMembership.create({
      data: { societyId, userId: user.id, flatId, role, residencyType, status: 'ACTIVE', isPrimary: over.isPrimary ?? false },
    });
    const token = (await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200)).body.data.accessToken as string;
    return { userId: user.id, token, firstName: user.firstName };
  }

  async function newFlat() {
    flatNo += 1;
    return (await http().post('/api/v1/flats').set(auth(admin)).send({ buildingId, unitNumber: `${flatNo}`, flatCode: `R-${flatNo}` }).expect(201)).body.data.id as string;
  }

  async function newPeriod() {
    monthNo += 1;
    const year = 2041 + Math.floor((monthNo - 1) / 12);
    const m = ((monthNo - 1) % 12) + 1;
    const mm = String(m).padStart(2, '0');
    const id = (await http().post('/api/v1/billing/periods').set(auth(admin)).send({
      periodYear: year, periodMonth: m, startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-28`, dueDate: `${year}-${mm}-10`,
    }).expect(201)).body.data.id as string;
    await prisma.billingPeriod.update({ where: { id }, data: { status: 'PUBLISHED' } });
    return id;
  }

  async function newBill(periodId: string, flatId: string, amount: number) {
    invNo += 1;
    const period = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: periodId } });
    return prisma.maintenanceBill.create({
      data: {
        societyId, billingPeriodId: periodId, flatId, invoiceNumber: `INV-${UNIQUE}-${invNo}`, flatCode: `R-${flatNo}`,
        baseAmount: D(amount), totalAmount: D(amount), pendingAmount: D(amount), dueDate: period.dueDate, isPublished: true,
      },
    });
  }

  const record = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/payments/record').set(auth(token)).send({
      accountId, paymentDate: '2041-01-05', paymentMethod: 'CASH', ...body,
    });
  const bill = (id: string) => prisma.maintenanceBill.findUniqueOrThrow({ where: { id } });
  const balance = async () => (await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalance.toString();

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
      society: { name: `E2E Pay ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-p-${UNIQUE}@test.example`, contactPhone: phone(1) },
      admin: { firstName: 'Admin', lastName: 'P', email: `admin-p-${UNIQUE}@test.example`, phone: phone(1), password: PASSWORD },
    }).expect(201);
    admin = reg.body.data.accessToken;
    societyId = reg.body.data.memberships[0].societyId;
    buildingId = (await http().post('/api/v1/buildings').set(auth(admin)).send({ name: 'R', code: 'R' }).expect(201)).body.data.id;
    accountId = (await prisma.account.create({ data: { societyId, name: 'Main', accountType: 'CURRENT' } })).id;
    const flat = await newFlat();
    resident = (await addPerson(flat, SystemRole.RESIDENT, 'OWNER', { isPrimary: true })).token;
  });

  afterAll(async () => {
    if (societyId) await prisma.society.update({ where: { id: societyId }, data: { deletedAt: new Date() } });
    await app.close();
  });

  describe('recording that a flat has paid', () => {
    it('settles the bill, puts the money in the account and its ledger, and tells the resident', async () => {
      const flat = await newFlat();
      const owner = await addPerson(flat, SystemRole.RESIDENT, 'OWNER', { isPrimary: true });
      const p = await newPeriod();
      const b = await newBill(p, flat, 4000);
      const before = D(await balance());

      const res = await record(admin, { maintenanceBillId: b.id, amount: 4000, notes: 'Cash given at the office' }).expect(201);
      expect(res.body.data.status).toBe('APPROVED');

      const after = await bill(b.id);
      expect(after.isPaid).toBe(true);
      expect(after.pendingAmount.toString()).toBe('0');
      expect(D(await balance()).minus(before).toString()).toBe('4000');

      const payment = await prisma.paymentSubmission.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(payment.userId).toBe(owner.userId); // filed under the resident, so it shows in their history
      expect(payment.reviewedById).not.toBe(owner.userId);
      expect(payment.transactionId).toBeTruthy();
      expect(payment.notes).toContain('Recorded by the admin');

      const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: payment.transactionId as string } });
      expect(tx.accountId).toBe(accountId);
      expect(tx.transactionType).toBe('CREDIT');

      expect(await prisma.notificationRecord.count({ where: { userId: owner.userId, notification: { type: 'PAYMENT_APPROVED' } } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { societyId, entityId: payment.id, action: 'PAYMENT_APPROVED' } })).toBe(1);
    });

    it('records a part payment and leaves the rest unpaid', async () => {
      const flat = await newFlat();
      await addPerson(flat, SystemRole.RESIDENT, 'OWNER', { isPrimary: true });
      const b = await newBill(await newPeriod(), flat, 3000);
      await record(admin, { maintenanceBillId: b.id, amount: 1000 }).expect(201);
      const after = await bill(b.id);
      expect(after.isPaid).toBe(false);
      expect(after.pendingAmount.toString()).toBe('2000');
      expect(after.paidAmount.toString()).toBe('1000');
    });

    it('clears the oldest unpaid month first when the flat owes more than one', async () => {
      const flat = await newFlat();
      await addPerson(flat, SystemRole.RESIDENT, 'OWNER', { isPrimary: true });
      const older = await newBill(await newPeriod(), flat, 1000);
      const newer = await newBill(await newPeriod(), flat, 1000);
      await record(admin, { maintenanceBillId: newer.id, amount: 1000 }).expect(201);
      expect((await bill(older.id)).isPaid).toBe(true);
      expect((await bill(newer.id)).isPaid).toBe(false);
    });

    it('files a flat with a tenant and an owner under the tenant', async () => {
      const flat = await newFlat();
      await addPerson(flat, SystemRole.RESIDENT, 'OWNER', { isPrimary: true });
      const tenant = await addPerson(flat, SystemRole.RESIDENT, 'TENANT');
      const b = await newBill(await newPeriod(), flat, 500);
      const res = await record(admin, { maintenanceBillId: b.id, amount: 500 }).expect(201);
      expect((await prisma.paymentSubmission.findUniqueOrThrow({ where: { id: res.body.data.id } })).userId).toBe(tenant.userId);
    });

    it('refuses a bill that is already paid, an unpublished one, and a missing one', async () => {
      const flat = await newFlat();
      await addPerson(flat, SystemRole.RESIDENT, 'OWNER', { isPrimary: true });
      const p = await newPeriod();
      const paid = await newBill(p, flat, 100);
      await record(admin, { maintenanceBillId: paid.id, amount: 100 }).expect(201);
      expect(messageOf((await record(admin, { maintenanceBillId: paid.id, amount: 100 }).expect(400)).body)).toMatch(/already paid/);

      const draft = await newBill(await newPeriod(), flat, 100);
      await prisma.maintenanceBill.update({ where: { id: draft.id }, data: { isPublished: false } });
      expect(messageOf((await record(admin, { maintenanceBillId: draft.id, amount: 100 }).expect(400)).body)).toMatch(/not been published/);

      await record(admin, { maintenanceBillId: 'does-not-exist', amount: 100 }).expect(404);
    });

    it('refuses a mistyped amount far above what the flat owes, without moving any money', async () => {
      const flat = await newFlat();
      await addPerson(flat, SystemRole.RESIDENT, 'OWNER', { isPrimary: true });
      const b = await newBill(await newPeriod(), flat, 1000);
      const before = await balance();
      expect(messageOf((await record(admin, { maintenanceBillId: b.id, amount: 5_000_000 }).expect(400)).body)).toMatch(/more than this flat can pay/);
      expect(await balance()).toBe(before);
      expect(await prisma.paymentSubmission.count({ where: { maintenanceBillId: b.id } })).toBe(0);
    });

    it('records one reference number once', async () => {
      const flat = await newFlat();
      await addPerson(flat, SystemRole.RESIDENT, 'OWNER', { isPrimary: true });
      const b = await newBill(await newPeriod(), flat, 2000);
      await record(admin, { maintenanceBillId: b.id, amount: 500, paymentMethod: 'UPI', utrNumber: `UTR-${UNIQUE}` }).expect(201);
      await record(admin, { maintenanceBillId: b.id, amount: 500, paymentMethod: 'UPI', utrNumber: `UTR-${UNIQUE}` }).expect(409);
      expect((await bill(b.id)).paidAmount.toString()).toBe('500');
    });

    it('refuses an account that is not the society\'s, or has been removed', async () => {
      const flat = await newFlat();
      await addPerson(flat, SystemRole.RESIDENT, 'OWNER', { isPrimary: true });
      const b = await newBill(await newPeriod(), flat, 100);
      await record(admin, { maintenanceBillId: b.id, amount: 100, accountId: 'nope' }).expect(404);
      const gone = await prisma.account.create({ data: { societyId, name: 'Old', accountType: 'CURRENT', isActive: false } });
      await record(admin, { maintenanceBillId: b.id, amount: 100, accountId: gone.id }).expect(404);
      expect((await bill(b.id)).isPaid).toBe(false);
    });

    it('is for the admin and accountant only — not a resident', async () => {
      const flat = await newFlat();
      await addPerson(flat, SystemRole.RESIDENT, 'OWNER', { isPrimary: true });
      const b = await newBill(await newPeriod(), flat, 100);
      await record(resident, { maintenanceBillId: b.id, amount: 100 }).expect(403);
      expect((await bill(b.id)).isPaid).toBe(false);
    });

    it('cannot record a bill belonging to another society', async () => {
      const other = await http().post('/api/v1/auth/register-society').send({
        society: { name: `E2E Other ${UNIQUE}`, address: '2 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-o-${UNIQUE}@test.example`, contactPhone: phone(2) },
        admin: { firstName: 'Other', lastName: 'O', email: `admin-o-${UNIQUE}@test.example`, phone: phone(2), password: PASSWORD },
      }).expect(201);
      try {
        const flat = await newFlat();
        const b = await newBill(await newPeriod(), flat, 100);
        await http().post('/api/v1/payments/record').set(auth(other.body.data.accessToken)).send({
          maintenanceBillId: b.id, accountId, amount: 100, paymentDate: '2041-01-05', paymentMethod: 'CASH',
        }).expect(404);
        expect((await bill(b.id)).isPaid).toBe(false);
      } finally {
        await prisma.society.update({ where: { id: other.body.data.memberships[0].societyId }, data: { deletedAt: new Date() } });
      }
    });
  });

  describe('reminders', () => {
    it('goes to the tenant when a flat has an owner and a tenant, and to the owner when it has no tenant', async () => {
      const both = await newFlat();
      await addPerson(both, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: uniquePhone(1) });
      const tenant = await addPerson(both, SystemRole.RESIDENT, 'TENANT', { phone: uniquePhone(2) });
      const ownerOnly = await newFlat();
      const owner = await addPerson(ownerOnly, SystemRole.RESIDENT, 'OWNER', { isPrimary: true, phone: uniquePhone(3) });
      const p = await newPeriod();
      await newBill(p, both, 1500);
      await newBill(p, ownerOnly, 2500);

      const list = (await http().get(`/api/v1/billing/periods/${p}/reminders`).set(auth(admin)).expect(200)).body.data as any[];
      expect(list).toHaveLength(2);
      const forBoth = list.find((r) => r.userId === tenant.userId);
      expect(forBoth).toMatchObject({ residentType: 'TENANT', residentPhone: uniquePhone(2), pendingAmount: '1500' });
      const forOwner = list.find((r) => r.userId === owner.userId);
      expect(forOwner).toMatchObject({ residentType: 'OWNER', residentPhone: uniquePhone(3) });
      // the bills list the admin looks at agrees on who each flat's contact is
      const bills = (await http().get(`/api/v1/billing/periods/${p}/bills`).set(auth(admin)).expect(200)).body.data as any[];
      expect(bills.find((b) => b.flatId === both)).toMatchObject({ residentType: 'TENANT', residentPhone: uniquePhone(2) });
      expect(bills.find((b) => b.flatId === ownerOnly)).toMatchObject({ residentType: 'OWNER' });
    });

    it('words each reminder from the society\'s own template', async () => {
      const flat = await newFlat();
      const person = await addPerson(flat, SystemRole.RESIDENT, 'OWNER', { isPrimary: true });
      const p = await newPeriod();
      await newBill(p, flat, 1234);
      await http().patch('/api/v1/societies/my/config').set(auth(admin)).send({ reminderTemplate: 'Hi {name}, Flat {flat} owes ₹{amount} ({month}).' }).expect(200);

      const list = (await http().get(`/api/v1/billing/periods/${p}/reminders`).set(auth(admin)).expect(200)).body.data as any[];
      const mine = list.find((r) => r.userId === person.userId);
      expect(mine.message).toMatch(/^Hi Owner\d+ Test, Flat R-\d+ owes ₹1,234 \(\w+ 204\d\)\.$/);

      const t = (await http().get('/api/v1/billing/reminder-template').set(auth(admin)).expect(200)).body.data;
      expect(t).toMatchObject({ template: 'Hi {name}, Flat {flat} owes ₹{amount} ({month}).', isDefault: false });
      expect(t.defaultTemplate).toContain('{name}');

      // blank goes back to the default
      await http().patch('/api/v1/societies/my/config').set(auth(admin)).send({ reminderTemplate: '' }).expect(200);
      expect((await http().get('/api/v1/billing/reminder-template').set(auth(admin)).expect(200)).body.data.isDefault).toBe(true);
    });

    it('leaves paid flats out, and sends an in-app reminder to the others only', async () => {
      const unpaid = await newFlat();
      const unpaidPerson = await addPerson(unpaid, SystemRole.RESIDENT, 'OWNER', { isPrimary: true });
      const paid = await newFlat();
      const paidPerson = await addPerson(paid, SystemRole.RESIDENT, 'OWNER', { isPrimary: true });
      const empty = await newFlat(); // nobody registered
      const p = await newPeriod();
      await newBill(p, unpaid, 900);
      const done = await newBill(p, paid, 900);
      await newBill(p, empty, 900);
      await record(admin, { maintenanceBillId: done.id, amount: 900 }).expect(201);

      const res = (await http().post(`/api/v1/billing/periods/${p}/remind`).set(auth(admin)).expect(201)).body.data;
      expect(res.unpaid).toBe(2);
      expect(res.sent).toBe(1);
      expect(res.withoutResident).toEqual([`R-${flatNo}`]);

      expect(await prisma.notificationRecord.count({ where: { userId: unpaidPerson.userId, notification: { type: 'BILL_REMINDER' } } })).toBe(1);
      expect(await prisma.notificationRecord.count({ where: { userId: paidPerson.userId, notification: { type: 'BILL_REMINDER' } } })).toBe(0);
    });

    it('is for the admin and accountant only', async () => {
      const p = await newPeriod();
      await http().get(`/api/v1/billing/periods/${p}/reminders`).set(auth(resident)).expect(403);
      await http().post(`/api/v1/billing/periods/${p}/remind`).set(auth(resident)).expect(403);
      await http().get('/api/v1/billing/reminder-template').set(auth(resident)).expect(403);
    });
  });
});
