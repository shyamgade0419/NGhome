/**
 * The receipt a "payment received" WhatsApp message links to — on a REAL Postgres.
 *
 * What a fake cannot prove: the page opens with no login and shows the real payment; only an approved payment has one; a
 * link that is wrong, tampered with, for another payment or for a payment that does not exist all get the same empty answer
 * (nothing about why); one payment's page never shows another's; whatever a person typed is escaped; and the page is sent
 * as a locked-down HTML page, not the app's usual JSON.
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
import { makeReceiptToken, receiptSecret, receiptUrl } from '../src/receipts/receipt-link';

jest.setTimeout(180_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const RUN = String(Math.floor(10000 + Math.random() * 89999));
const email = (label: string) => `${label}-${UNIQUE}@test.example`.toLowerCase();
const EVIL = '<script>alert(1)</script><img src=x onerror=alert(2)>';

describe('Receipt page (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http_ = () => request(app.getHttpServer());
  const savedSecret = process.env.RECEIPT_LINK_SECRET;

  let societyId: string;
  let flatA: string;
  let flatB: string;
  let approved: string;
  let approvedOther: string;
  let pending: string;
  let rejected: string;
  let underReview: string;
  let evilPayment: string;

  const pathOf = (id: string) => new URL(receiptUrl(id)!).pathname;

  async function makeResident(label: string, flatId: string, firstName: string) {
    const user = await prisma.user.create({
      data: { email: email(label), firstName, lastName: 'Resident', phone: '95' + RUN + String(Math.floor(Math.random() * 900) + 100), passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId, role: 'RESIDENT', status: 'ACTIVE', isPrimary: true } });
    return user.id;
  }

  async function pay(userId: string, flatId: string, billId: string, amount: number, status: any, extra: Record<string, unknown> = {}) {
    const p = await prisma.paymentSubmission.create({
      data: { societyId, flatId, userId, maintenanceBillId: billId, amount, paymentDate: new Date('2026-11-08T05:00:00Z'), paymentMethod: 'UPI', status, ...extra },
    });
    if (status === 'APPROVED') await prisma.paymentAllocation.create({ data: { societyId, paymentId: p.id, billId, amount } });
    return p.id;
  }

  beforeAll(async () => {
    process.env.RECEIPT_LINK_SECRET = 'e2e-receipt-secret-0123456789abcdef';
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = moduleFixture.get(PrismaService);

    const ph = '91' + RUN + '001';
    const reg = await http_().post('/api/v1/auth/register-society').send({
      society: { name: `E2E Receipt ${UNIQUE}`, address: 'Plot 14', city: 'Hyderabad', state: 'Telangana', pinCode: '500081', country: 'India', contactEmail: email('soc'), contactPhone: ph },
      admin: { firstName: 'Admin', lastName: 'R', email: email('admin'), phone: ph, password: PASSWORD },
    }).expect(201);
    societyId = reg.body.data.memberships[0].societyId;

    const building = await prisma.building.create({ data: { societyId, name: 'Tower A' } });
    flatA = (await prisma.flat.create({ data: { societyId, buildingId: building.id, unitNumber: '101', flatCode: 'A-101' } })).id;
    flatB = (await prisma.flat.create({ data: { societyId, buildingId: building.id, unitNumber: '102', flatCode: 'A-102' } })).id;
    const period = await prisma.billingPeriod.create({
      data: { societyId, periodYear: 2026, periodMonth: 10, startDate: new Date(2026, 9, 1), endDate: new Date(2026, 9, 28), dueDate: new Date(2026, 9, 10), status: 'PUBLISHED' },
    });
    const bill = (flatId: string, code: string, invoice: string, total: number, paid: number) =>
      prisma.maintenanceBill.create({
        data: { societyId, billingPeriodId: period.id, flatId, flatCode: code, invoiceNumber: invoice, baseAmount: total, totalAmount: total, paidAmount: paid, pendingAmount: total - paid, dueDate: period.dueDate, isPaid: paid >= total, isPublished: true },
      });
    const billA = await bill(flatA, 'A-101', 'INV-A-101', 3500, 1000);
    const billB = await bill(flatB, 'A-102', 'INV-A-102', 4200, 4200);

    const ravi = await makeResident('ravi', flatA, 'Ravi');
    const meera = await makeResident('meera', flatB, 'Meera');
    approved = await pay(ravi, flatA, billA.id, 1000, 'APPROVED', { utrNumber: `UTR${UNIQUE}` });
    approvedOther = await pay(meera, flatB, billB.id, 4200, 'APPROVED', { paymentMethod: 'CASH' });
    pending = await pay(ravi, flatA, billA.id, 500, 'PENDING');
    rejected = await pay(ravi, flatA, billA.id, 600, 'REJECTED');
    underReview = await pay(ravi, flatA, billA.id, 700, 'UNDER_REVIEW');

    // a payer, a society name and a reference with markup in them
    const evilUser = await makeResident('evil', flatA, EVIL);
    evilPayment = await pay(evilUser, flatA, billA.id, 100, 'APPROVED', { referenceNumber: EVIL, paymentMethod: 'CHEQUE' });
    await prisma.society.update({ where: { id: societyId }, data: { displayName: `Sunrise ${EVIL}` } });
  });

  afterAll(async () => {
    if (savedSecret === undefined) delete process.env.RECEIPT_LINK_SECRET;
    else process.env.RECEIPT_LINK_SECRET = savedSecret;
    await prisma.society.updateMany({ where: { name: { contains: 'E2E Receipt' }, AND: { name: { contains: String(UNIQUE) } } }, data: { deletedAt: new Date() } });
    await app.close();
  });

  describe('an approved payment', () => {
    it('opens with no login, and shows who paid what, for which flat and which bill', async () => {
      const res = await http_().get(pathOf(approved)).expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.text).toContain('₹1,000.00');
      expect(res.text).toContain('Ravi Resident');
      expect(res.text).toContain('A-101');
      expect(res.text).toContain('INV-A-101');
      expect(res.text).toContain('October 2026');
      expect(res.text).toContain(`UTR${UNIQUE}`);
      expect(res.text).toContain('UPI');
      expect(res.text).toContain('8 November 2026');
      expect(res.text).toContain('Plot 14, Hyderabad, Telangana');
      expect(res.text).toMatch(/RCT-[0-9A-F]{8}/);
    });

    it('says what the flat still owes', async () => {
      const res = await http_().get(pathOf(approved)).expect(200);
      expect(res.text).toContain('Balance still due');
      expect(res.text).toContain('₹2,500.00'); // 3,500 billed, 1,000 paid
    });

    it('says nothing is due for a flat that is paid up', async () => {
      const res = await http_().get(pathOf(approvedOther)).expect(200);
      expect(res.text).toContain('Nothing is due');
      expect(res.text).toContain('Cash');
    });

    it('never shows another payment, flat or person', async () => {
      const res = await http_().get(pathOf(approved)).expect(200);
      expect(res.text).not.toContain('Meera');
      expect(res.text).not.toContain('A-102');
      expect(res.text).not.toContain('INV-A-102');
      expect(res.text).not.toContain('₹4,200');
    });

    it('is sent as a locked-down page: not cached, not indexed, one script, nothing from outside', async () => {
      const res = await http_().get(pathOf(approved)).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toMatch(/noindex/);
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      const csp = res.headers['content-security-policy'] as string;
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      const nonce = csp.match(/script-src 'nonce-([^']+)'/)![1];
      expect(res.text).toContain(`<script nonce="${nonce}">`);
      expect(res.text.match(/<script/g)).toHaveLength(1);
      // a new nonce each time
      const again = await http_().get(pathOf(approved)).expect(200);
      expect((again.headers['content-security-policy'] as string).match(/'nonce-([^']+)'/)![1]).not.toBe(nonce);
    });

    it('is the page, not the app\'s JSON wrapper', async () => {
      const res = await http_().get(pathOf(approved)).expect(200);
      expect(() => JSON.parse(res.text)).toThrow();
      expect(res.text.startsWith('<!doctype html>')).toBe(true);
    });

    it('escapes whatever a person typed: the payer, the reference and the society name', async () => {
      const res = await http_().get(pathOf(evilPayment)).expect(200);
      expect(res.text).not.toContain('<script>alert(1)');
      expect(res.text).not.toContain('<img src=x');
      expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(res.text.match(/<script/g)).toHaveLength(1); // only the page's own
    });
  });

  describe('a link that is not good', () => {
    let nothing: string;

    beforeAll(async () => {
      nothing = (await http_().get('/api/v1/public/receipts/not-a-token').expect(404)).text;
    });

    it('gets the same empty answer for a payment that was not approved', async () => {
      for (const id of [pending, rejected, underReview]) {
        const res = await http_().get(pathOf(id)).expect(404);
        expect(res.text).toBe(nothing);
      }
    });

    it('gets the same empty answer when the link is tampered with, or is for a payment that does not exist', async () => {
      const real = pathOf(approved);
      const flipped = real.slice(0, -1) + (real.endsWith('A') ? 'B' : 'A');
      expect((await http_().get(flipped).expect(404)).text).toBe(nothing);

      const [idPart] = real.split('/').pop()!.split('.');
      const [, otherSig] = makeReceiptToken(approvedOther, receiptSecret()!)!.split('.');
      expect((await http_().get(`/api/v1/public/receipts/${idPart}.${otherSig}`).expect(404)).text).toBe(nothing); // another payment's signature

      const ghost = '00000000-0000-4000-8000-000000000001';
      expect((await http_().get(pathOf(ghost)).expect(404)).text).toBe(nothing); // validly signed, but there is no such payment
    });

    it('gets the same empty answer for things that are not tokens at all', async () => {
      for (const bad of ['x', 'a.b', 'x'.repeat(45), `${'a'.repeat(22)}.${'b'.repeat(22)}`, '%3Cb%3Ex%3C', 'a%20b']) {
        expect((await http_().get(`/api/v1/public/receipts/${bad}`).expect(404)).text).toBe(nothing);
      }
    });

    it('does not say why: no mention of tokens, signatures or payments', () => {
      expect(nothing).toContain('not valid');
      expect(nothing).not.toMatch(/signature|token|payment|expired/i);
    });

    it('is refused for every link when the server has no secret to check it with', async () => {
      const keep = process.env.RECEIPT_LINK_SECRET;
      const path = pathOf(approved);
      const others = { s: process.env.SETTINGS_ENCRYPTION_KEY, j: process.env.JWT_ACCESS_SECRET };
      delete process.env.RECEIPT_LINK_SECRET;
      delete process.env.SETTINGS_ENCRYPTION_KEY;
      delete process.env.JWT_ACCESS_SECRET;
      try {
        expect((await http_().get(path).expect(404)).text).toBe(nothing);
      } finally {
        process.env.RECEIPT_LINK_SECRET = keep;
        if (others.s !== undefined) process.env.SETTINGS_ENCRYPTION_KEY = others.s;
        if (others.j !== undefined) process.env.JWT_ACCESS_SECRET = others.j;
      }
    });
  });
});
