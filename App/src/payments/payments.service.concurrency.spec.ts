/**
 * Real races, not sequential mocking. The mock below models
 * payment_submissions/accounts/bills/transactions as mutable Maps and
 * gives every conditional write (the (flatId, utrNumber) unique index on
 * create(), and updateMany's status-gated claim) the same check-and-mutate-
 * in-one-step semantics a single Postgres statement has — nothing async
 * happens between reading the current state and writing the new one. That
 * is what makes Promise.all([...]) below a faithful stand-in for two
 * requests racing on the real database, and is exactly what
 * PaymentsService already depends on (submit()'s (flatId, utrNumber)
 * unique index from a prior hardening pass; approve()/reject()'s atomic
 * status-gated updateMany, unchanged by this pass — both already correct,
 * neither had a test proving it against a genuine concurrent race).
 * It proves the application logic is correct given atomic single
 * statements, which Postgres provides for real — it is not a substitute
 * for testing against a live database under real concurrent load, which
 * this sandbox has no access to.
 */

import { Prisma, PaymentStatus } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { SftpStorageService } from '../documents/sftp-storage.service';
import { StoragePathService } from '../documents/storage-path.service';
import { NotificationsService } from '../notifications/notifications.service';

const SOCIETY_ID = 'society-a';
const FLAT_ID = 'flat-10';
const OWNER_ID = 'resident-1';
const ADMIN_ID = 'admin-1';
const ACCOUNT_ID = 'account-1';
const BILL_ID = 'bill-1';

function p2002(): Prisma.PrismaClientKnownRequestError {
  const err = Object.assign(new Error('Unique constraint failed on the fields: (`flatId`,`utrNumber`)'), {
    code: 'P2002',
  });
  Object.setPrototypeOf(err, Prisma.PrismaClientKnownRequestError.prototype);
  return err as Prisma.PrismaClientKnownRequestError;
}

function makeStatefulServices() {
  const payments = new Map<string, any>();
  const accounts = new Map<string, any>();
  const bills = new Map<string, any>();
  const transactions: any[] = [];
  const auditLogs: any[] = [];
  let nextId = 1;

  const paymentApi = {
    findFirst: jest.fn(async ({ where }: any) => {
      const rows = [...payments.values()];
      const row = where.id
        ? rows.find((r) => r.id === where.id && (!where.societyId || r.societyId === where.societyId))
        : rows.find((r) => r.societyId === where.societyId && r.flatId === where.flatId && r.utrNumber === where.utrNumber);
      return row ? { ...row, documents: [] } : null;
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const row = payments.get(where.id);
      return row ? { ...row } : null;
    }),
    create: jest.fn(async ({ data }: any) => {
      // Simulates the real @@unique([flatId, utrNumber]) index.
      if (data.utrNumber) {
        const dup = [...payments.values()].find((r) => r.flatId === data.flatId && r.utrNumber === data.utrNumber);
        if (dup) throw p2002();
      }
      const id = `payment-${nextId++}`;
      const row = { id, status: PaymentStatus.PENDING, createdAt: new Date(), ...data };
      payments.set(id, row);
      return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of payments.values()) {
        if (row.id !== where.id) continue;
        if (where.status?.in && !where.status.in.includes(row.status)) continue;
        Object.assign(row, data);
        count++;
      }
      return { count };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = payments.get(where.id);
      Object.assign(row, data);
      return { ...row };
    }),
  };

  const accountApi = {
    findFirst: jest.fn(async ({ where }: any) => {
      const row = accounts.get(where.id);
      if (!row || row.societyId !== where.societyId) return null;
      return { ...row };
    }),
    findMany: jest.fn(async () => [...accounts.values()].filter((a) => a.isActive)),
    update: jest.fn(async ({ where, data }: any) => {
      const row = accounts.get(where.id);
      if (data.currentBalance?.increment !== undefined) {
        row.currentBalance = row.currentBalance.plus(data.currentBalance.increment);
      }
      return { ...row };
    }),
  };

  /**
   * The bill's overpayment guard spans two statements in one transaction
   * (the conditional paidAmount increment, then a follow-up write that
   * recomputes pendingAmount/isPaid) — safe in real Postgres because a row
   * lock, once taken by the first statement that touches a row, is held
   * for the rest of the *transaction*, not just that one statement; a
   * second transaction's conflicting UPDATE on the same row blocks until
   * the first one commits or rolls back, statements and all. A mock that
   * released the "lock" after each individual call (as a naive per-call
   * mock would) is measurably more permissive than real Postgres here — it
   * was tried, and let two concurrent payments jointly overpay a bill in
   * this test file's own git history. billLocks below exists specifically
   * to hold a row "locked" for the true duration of whichever transaction
   * first touches it, the same guarantee Postgres actually provides.
   */
  const billLocks = new Map<string, Promise<void>>();

  async function acquireBillLock(id: string, heldByThisTx: Set<string>, txDone: Promise<void>): Promise<void> {
    if (heldByThisTx.has(id)) return;
    while (billLocks.has(id)) {
      await billLocks.get(id);
    }
    heldByThisTx.add(id);
    billLocks.set(id, txDone);
  }

  function makeBillApi(heldByThisTx: Set<string>, txDone: Promise<void>) {
    return {
      findFirst: jest.fn(async ({ where }: any) => {
        const row = bills.get(where.id);
        if (!row) return null;
        if (where.societyId && row.societyId !== where.societyId) return null;
        if (where.flatId && row.flatId !== where.flatId) return null;
        return { ...row };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        await acquireBillLock(where.id, heldByThisTx, txDone);
        const row = bills.get(where.id);
        return row ? { ...row } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        await acquireBillLock(where.id, heldByThisTx, txDone);
        const row = bills.get(where.id);
        if (data.paidAmount?.increment !== undefined) {
          row.paidAmount = row.paidAmount.plus(data.paidAmount.increment);
        }
        if (data.pendingAmount !== undefined) row.pendingAmount = data.pendingAmount;
        if (data.isPaid !== undefined) row.isPaid = data.isPaid;
        return { ...row };
      }),
      // The one operation the joint-overpayment race test depends on being
      // atomic — see PaymentsService.submit/approve. Mirrors exactly what
      // the real call does: conditionally increment paidAmount only.
      // pendingAmount/isPaid are recomputed by the service's own follow-up
      // .update() call, same as production — not duplicated here.
      updateMany: jest.fn(async ({ where, data }: any) => {
        await acquireBillLock(where.id, heldByThisTx, txDone);
        const row = bills.get(where.id);
        if (!row) return { count: 0 };
        if (where.pendingAmount?.gte !== undefined && row.pendingAmount.lessThan(where.pendingAmount.gte)) {
          return { count: 0 };
        }
        if (data.paidAmount?.increment !== undefined) {
          row.paidAmount = row.paidAmount.plus(data.paidAmount.increment);
        }
        return { count: 1 };
      }),
    };
  }

  const transactionApi = {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `txn-${nextId++}`, ...data };
      transactions.push(row);
      return row;
    }),
  };

  const documentApi = { create: jest.fn(async ({ data }: any) => ({ id: `doc-${nextId++}`, ...data })) };
  const auditLogApi = { create: jest.fn(async ({ data }: any) => { auditLogs.push(data); return data; }) };
  const configApi = { findUnique: jest.fn(async () => ({ paymentVerificationRequired: true })) };
  const membershipApi = { findFirst: jest.fn(async () => ({ id: 'membership-1' })) };

  // A plain, lock-free read — matches real Postgres, where a bare SELECT
  // outside a transaction never takes a row lock. Used by submit()'s
  // initial bill lookup, before any transaction opens.
  const topLevelBillFindFirst = jest.fn(async ({ where }: any) => {
    const row = bills.get(where.id);
    if (!row) return null;
    if (where.societyId && row.societyId !== where.societyId) return null;
    if (where.flatId && row.flatId !== where.flatId) return null;
    return { ...row };
  });

  // A fresh maintenanceBill API per $transaction call — see the comment on
  // billLocks above. Everything else is shared, untracked state, matching
  // how these other tables' safety is proven elsewhere in this file (via
  // their own single-statement atomic conditional writes).
  const prisma = {
    paymentSubmission: paymentApi,
    account: accountApi,
    maintenanceBill: { findFirst: topLevelBillFindFirst },
    societyConfiguration: configApi,
    societyMembership: membershipApi,
    $transaction: jest.fn(async (cb: any) => {
      const heldByThisTx = new Set<string>();
      let releaseAll!: () => void;
      const txDone = new Promise<void>((resolve) => { releaseAll = resolve; });
      const tx = {
        paymentSubmission: paymentApi,
        account: accountApi,
        maintenanceBill: makeBillApi(heldByThisTx, txDone),
        transaction: transactionApi,
        document: documentApi,
        auditLog: auditLogApi,
      };
      try {
        return await cb(tx);
      } finally {
        releaseAll();
        for (const id of heldByThisTx) {
          if (billLocks.get(id) === txDone) billLocks.delete(id);
        }
      }
    }),
  } as unknown as PrismaService;

  const storage = { upload: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) } as unknown as SftpStorageService;
  const notifications = {
    sendToUsers: jest.fn().mockResolvedValue(null),
    notifyQuietly: jest.fn(async (fn: () => Promise<unknown>) => { await fn(); }),
  } as unknown as NotificationsService;

  const service = new PaymentsService(prisma, storage, notifications, new StoragePathService(storage));

  function seedAccount(id: string, overrides: Record<string, unknown> = {}) {
    accounts.set(id, { id, societyId: SOCIETY_ID, isActive: true, currentBalance: new Prisma.Decimal(100000), ...overrides });
  }
  function seedBill(id: string, overrides: Record<string, unknown> = {}) {
    bills.set(id, {
      id, societyId: SOCIETY_ID, flatId: FLAT_ID, isPaid: false,
      totalAmount: new Prisma.Decimal(2500), paidAmount: new Prisma.Decimal(0), pendingAmount: new Prisma.Decimal(2500),
      ...overrides,
    });
  }
  function seedPayment(id: string, overrides: Record<string, unknown> = {}) {
    const row = {
      id, societyId: SOCIETY_ID, flatId: FLAT_ID, userId: OWNER_ID,
      amount: new Prisma.Decimal(2500), status: PaymentStatus.PENDING,
      utrNumber: null, maintenanceBillId: null, transactionId: null,
      ...overrides,
    };
    payments.set(id, row);
    return row;
  }

  return { service, payments, accounts, bills, transactions, auditLogs, configApi, seedAccount, seedBill, seedPayment };
}

describe('PaymentsService.submit — concurrent submission with the identical UTR', () => {
  it('two simultaneous submissions of the same (flat, UTR): exactly one payment row is created', async () => {
    const { service, payments } = makeStatefulServices();
    const dto = { amount: 2500, paymentDate: '2026-09-09', paymentMethod: 'UPI' as any, utrNumber: 'utr-race-1' };

    const results = await Promise.allSettled([
      service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, dto),
      service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, dto),
    ]);

    // Both settle successfully — the loser gets the winner's row back via
    // the P2002 fallback, not an error — but only one row was ever created.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const forThisUtr = [...payments.values()].filter((p) => p.utrNumber === 'utr-race-1');
    expect(forThisUtr).toHaveLength(1);

    const [a, b] = results as PromiseFulfilledResult<any>[];
    expect(a.value.id).toBe(b.value.id); // both callers ended up with the SAME payment
  });

  it('five simultaneous submissions of the same UTR: still exactly one payment row', async () => {
    const { service, payments } = makeStatefulServices();
    const dto = { amount: 2500, paymentDate: '2026-09-09', paymentMethod: 'UPI' as any, utrNumber: 'utr-race-2' };

    await Promise.allSettled(Array.from({ length: 5 }, () => service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, dto)));

    expect([...payments.values()].filter((p) => p.utrNumber === 'utr-race-2')).toHaveLength(1);
  });
});

describe('PaymentsService.approve — concurrent approval of the same payment', () => {
  it(
    'two simultaneous approve() calls for the same payment: exactly one account credit, one Transaction, ' +
      'one APPROVED payment — account ends at initial plus ONE payment amount, not two',
    async () => {
      const { service, accounts, transactions, payments, seedAccount, seedPayment } = makeStatefulServices();
      seedAccount(ACCOUNT_ID, { currentBalance: new Prisma.Decimal(100000) });
      seedPayment('payment-1', { amount: new Prisma.Decimal(2500), status: PaymentStatus.PENDING });

      const results = await Promise.allSettled([
        service.approve(SOCIETY_ID, 'payment-1', ADMIN_ID, ACCOUNT_ID),
        service.approve(SOCIETY_ID, 'payment-1', ADMIN_ID, ACCOUNT_ID),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1); // the loser gets "Payment is not in a reviewable state"

      expect(accounts.get(ACCOUNT_ID).currentBalance.toString()).toBe('102500'); // NOT 105000
      expect(transactions).toHaveLength(1); // NOT 2
      expect(payments.get('payment-1').status).toBe(PaymentStatus.APPROVED);
      expect(payments.get('payment-1').transactionId).toBe(transactions[0].id);
    },
  );

  it('five simultaneous approve() calls for the same payment: still exactly one credit and one Transaction', async () => {
    const { service, accounts, transactions, seedAccount, seedPayment } = makeStatefulServices();
    seedAccount(ACCOUNT_ID, { currentBalance: new Prisma.Decimal(100000) });
    seedPayment('payment-1', { amount: new Prisma.Decimal(2500), status: PaymentStatus.PENDING });

    await Promise.allSettled(
      Array.from({ length: 5 }, () => service.approve(SOCIETY_ID, 'payment-1', ADMIN_ID, ACCOUNT_ID)),
    );

    expect(accounts.get(ACCOUNT_ID).currentBalance.toString()).toBe('102500');
    expect(transactions).toHaveLength(1);
  });

  it('one approve() and one reject() racing the same payment: exactly one of the two effects wins, never both', async () => {
    const { service, accounts, payments, seedAccount, seedPayment } = makeStatefulServices();
    seedAccount(ACCOUNT_ID, { currentBalance: new Prisma.Decimal(100000) });
    seedPayment('payment-1', { amount: new Prisma.Decimal(2500), status: PaymentStatus.PENDING });

    const results = await Promise.allSettled([
      service.approve(SOCIETY_ID, 'payment-1', ADMIN_ID, ACCOUNT_ID),
      service.reject(SOCIETY_ID, 'payment-1', ADMIN_ID, 'duplicate'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const finalStatus = payments.get('payment-1').status;
    expect([PaymentStatus.APPROVED, PaymentStatus.REJECTED]).toContain(finalStatus);
    // If approve won, the credit happened; if reject won, it must not have.
    const credited = accounts.get(ACCOUNT_ID).currentBalance.toString() === '102500';
    expect(credited).toBe(finalStatus === PaymentStatus.APPROVED);
  });
});

describe('PaymentsService.submit — two genuinely different concurrent payments both land correctly', () => {
  it(
    'two different UTRs against the same bill, submitted concurrently with auto-approve on: both succeed, ' +
      "and the bill/account end up reflecting BOTH payments — not one overwriting the other's write",
    async () => {
      const { service, bills, accounts, payments, configApi, seedAccount, seedBill } = makeStatefulServices();
      seedAccount(ACCOUNT_ID, { currentBalance: new Prisma.Decimal(0) });
      seedBill(BILL_ID, { totalAmount: new Prisma.Decimal(5000), paidAmount: new Prisma.Decimal(0), pendingAmount: new Prisma.Decimal(5000) });
      // Auto-approve requires verification off, exactly one active account,
      // a linked bill, and a UTR — see PaymentsService.submit.
      configApi.findUnique.mockResolvedValue({ paymentVerificationRequired: false });

      const makeDto = (utr: string) => ({
        maintenanceBillId: BILL_ID, amount: 2500, paymentDate: '2026-09-09', paymentMethod: 'UPI' as any, utrNumber: utr,
      });

      const results = await Promise.allSettled([
        service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, makeDto('utr-concurrent-a')),
        service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, makeDto('utr-concurrent-b')),
      ]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect([...payments.values()]).toHaveLength(2); // two distinct UTRs, two distinct payments

      // Both ₹2500 payments landed: not "initial + one payment" (a lost
      // update from an unguarded read-modify-write) and not "initial +
      // payment, doubled" (a duplicate write) — initial + both.
      expect(accounts.get(ACCOUNT_ID).currentBalance.toString()).toBe('5000');
      const bill = bills.get(BILL_ID);
      expect(bill.paidAmount.toString()).toBe('5000');
      expect(bill.isPaid).toBe(true);
    },
  );
});

describe('PaymentsService.submit — the overpayment guard under a genuine joint-overpayment race', () => {
  it(
    'two concurrent payments that each individually fit but would jointly exceed the bill: only one is ' +
      'accepted — paidAmount never exceeds totalAmount, even though neither payment alone was over the limit ' +
      "at the moment it was checked. (Confirmed this was a real gap before the fix: a read-then-check-then-" +
      'increment version of this guard let paidAmount reach 6000 against a 5000 total in this exact scenario.)',
    async () => {
      const { service, bills, seedAccount, seedBill, configApi } = makeStatefulServices();
      seedAccount(ACCOUNT_ID, { currentBalance: new Prisma.Decimal(0) });
      seedBill(BILL_ID, { totalAmount: new Prisma.Decimal(5000), paidAmount: new Prisma.Decimal(0), pendingAmount: new Prisma.Decimal(5000) });
      configApi.findUnique.mockResolvedValue({ paymentVerificationRequired: false });

      const makeDto = (utr: string) => ({
        maintenanceBillId: BILL_ID, amount: 3000, paymentDate: '2026-09-09', paymentMethod: 'UPI' as any, utrNumber: utr,
      });

      const results = await Promise.allSettled([
        service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, makeDto('utr-overpay-a')),
        service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, makeDto('utr-overpay-b')),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

      const bill = bills.get(BILL_ID);
      expect(bill.paidAmount.toString()).toBe('3000'); // NOT 6000
      expect(bill.paidAmount.lessThanOrEqualTo(bill.totalAmount)).toBe(true);
    },
  );
});

/**
 * The resume path (resumeExistingSubmission / tryAutoApproveExisting /
 * creditAndApprove) is the newer of the two ways a payment gets
 * auto-approved — a retry against a row that already exists, rather than
 * the fresh-creation path above. It shares creditAndApprove's atomic claim
 * with the create path, but unlike the create path (where nothing else can
 * see the row until the transaction commits), a resume's target row is
 * already visible to every other concurrent caller — an admin's manual
 * approve(), or another concurrent resume of the identical UTR. These
 * tests are the direct proof for the requirement that retrying/racing a
 * payment submission can never create a second financial Transaction.
 */
describe('PaymentsService.submit — concurrent resume of an existing PENDING payment', () => {
  it(
    'two concurrent retries of the same (flat, UTR) against an existing PENDING, auto-approve-eligible payment: ' +
      'exactly one account credit, one Transaction, one APPROVED payment — never two',
    async () => {
      const { service, accounts, transactions, payments, configApi, seedAccount, seedBill, seedPayment } =
        makeStatefulServices();
      seedAccount(ACCOUNT_ID, { currentBalance: new Prisma.Decimal(100000) });
      seedBill(BILL_ID);
      seedPayment('payment-resume-1', {
        amount: new Prisma.Decimal(2500),
        status: PaymentStatus.PENDING,
        utrNumber: 'utr-resume-race',
        maintenanceBillId: BILL_ID,
        transactionId: null,
        paymentDate: new Date('2026-09-09'),
      });
      configApi.findUnique.mockResolvedValue({ paymentVerificationRequired: false });

      const dto = {
        maintenanceBillId: BILL_ID, amount: 2500, paymentDate: '2026-09-09', paymentMethod: 'UPI' as any,
        utrNumber: 'utr-resume-race',
      };

      const results = await Promise.allSettled([
        service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, dto),
        service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, dto),
      ]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true); // the loser just gets the same (now-approved) row back, not an error
      expect(accounts.get(ACCOUNT_ID).currentBalance.toString()).toBe('102500'); // NOT 105000
      expect(transactions).toHaveLength(1); // NOT 2
      expect(payments.get('payment-resume-1').status).toBe(PaymentStatus.APPROVED);
      expect(payments.get('payment-resume-1').transactionId).toBe(transactions[0].id);
      // Still exactly the one payment row — the resume path never creates a second.
      expect([...payments.values()].filter((p) => p.utrNumber === 'utr-resume-race')).toHaveLength(1);
    },
  );

  it('five concurrent retries of the same eligible PENDING payment: still exactly one credit and one Transaction', async () => {
    const { service, accounts, transactions, configApi, seedAccount, seedBill, seedPayment } = makeStatefulServices();
    seedAccount(ACCOUNT_ID, { currentBalance: new Prisma.Decimal(100000) });
    seedBill(BILL_ID);
    seedPayment('payment-resume-2', {
      amount: new Prisma.Decimal(2500),
      status: PaymentStatus.PENDING,
      utrNumber: 'utr-resume-race-2',
      maintenanceBillId: BILL_ID,
      transactionId: null,
      paymentDate: new Date('2026-09-09'),
    });
    configApi.findUnique.mockResolvedValue({ paymentVerificationRequired: false });

    const dto = {
      maintenanceBillId: BILL_ID, amount: 2500, paymentDate: '2026-09-09', paymentMethod: 'UPI' as any,
      utrNumber: 'utr-resume-race-2',
    };

    await Promise.allSettled(Array.from({ length: 5 }, () => service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, dto)));

    expect(accounts.get(ACCOUNT_ID).currentBalance.toString()).toBe('102500');
    expect(transactions).toHaveLength(1);
  });

  it(
    "a resident's retry racing an admin's manual approve() of the SAME payment: exactly one of the two effects " +
      'wins, never both — the loser sees the winner\'s already-committed result, not a second credit',
    async () => {
      const { service, accounts, transactions, payments, configApi, seedAccount, seedBill, seedPayment } =
        makeStatefulServices();
      seedAccount(ACCOUNT_ID, { currentBalance: new Prisma.Decimal(100000) });
      seedBill(BILL_ID);
      seedPayment('payment-resume-3', {
        amount: new Prisma.Decimal(2500),
        status: PaymentStatus.PENDING,
        utrNumber: 'utr-resume-vs-approve',
        maintenanceBillId: BILL_ID,
        transactionId: null,
        paymentDate: new Date('2026-09-09'),
      });
      configApi.findUnique.mockResolvedValue({ paymentVerificationRequired: false });

      const dto = {
        maintenanceBillId: BILL_ID, amount: 2500, paymentDate: '2026-09-09', paymentMethod: 'UPI' as any,
        utrNumber: 'utr-resume-vs-approve',
      };

      await Promise.allSettled([
        service.submit(SOCIETY_ID, OWNER_ID, FLAT_ID, dto), // resident's retry (resume path)
        service.approve(SOCIETY_ID, 'payment-resume-3', ADMIN_ID, ACCOUNT_ID), // admin's manual approve()
      ]);

      // Both may fulfil — a resume that lost the claim returns the
      // already-approved row rather than erroring — but the money only
      // ever moved once.
      expect(accounts.get(ACCOUNT_ID).currentBalance.toString()).toBe('102500');
      expect(transactions).toHaveLength(1);
      expect(payments.get('payment-resume-3').status).toBe(PaymentStatus.APPROVED);
    },
  );
});
