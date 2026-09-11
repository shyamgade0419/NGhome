/**
 * paySalary() must claim the salary record atomically before any money
 * moves. The mock models salary_records/accounts/transactions as mutable
 * Maps and gives every write (updateMany's conditional WHERE, and the
 * account's atomic decrement) the same check-and-mutate-in-one-step
 * semantics a single Postgres statement has — nothing async happens
 * between reading the current value and writing the new one. That is what
 * makes Promise.all([...]) below a faithful stand-in for two requests
 * racing on the real database: whichever of two concurrent updateMany
 * calls runs first claims the row; the other's WHERE clause no longer
 * matches. It proves the application logic is correct given a truly
 * atomic single statement (which Postgres provides for a real UPDATE) —
 * it is not a substitute for testing against a live database under real
 * concurrent load, which this sandbox has no access to.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, SalaryStatus } from '@prisma/client';
import { SalariesService } from './salaries.service';
import { PrismaService } from '../prisma/prisma.service';

const SOCIETY_ID = 'society-a';
const OTHER_SOCIETY_ID = 'society-b';
const ACTOR_ID = 'admin-1';

function makeStatefulPrisma() {
  const salaryRecords = new Map<string, any>();
  const accounts = new Map<string, any>();
  const transactions: any[] = [];
  let nextTxnId = 1;

  function applyOp(current: Prisma.Decimal, op: unknown): Prisma.Decimal {
    if (op && typeof op === 'object' && 'decrement' in (op as any)) {
      return current.minus((op as any).decrement);
    }
    if (op && typeof op === 'object' && 'increment' in (op as any)) {
      return current.plus((op as any).increment);
    }
    return new Prisma.Decimal(op as any);
  }

  const salaryRecordApi = {
    findFirst: jest.fn(async ({ where }: any) => {
      const row = salaryRecords.get(where.id);
      if (!row || row.societyId !== where.societyId) return null;
      return { ...row };
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const row = salaryRecords.get(where.id);
      return row ? { ...row } : null;
    }),
    // The one operation the concurrency test depends on being atomic.
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of salaryRecords.values()) {
        if (row.id !== where.id || row.societyId !== where.societyId) continue;
        if (where.status?.in && !where.status.in.includes(row.status)) continue;
        Object.assign(row, data);
        count++;
      }
      return { count };
    }),
  };

  const accountApi = {
    findFirst: jest.fn(async ({ where }: any) => {
      const row = accounts.get(where.id);
      if (!row || row.societyId !== where.societyId) return null;
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = accounts.get(where.id);
      if (data.currentBalance !== undefined) {
        row.currentBalance = applyOp(row.currentBalance, data.currentBalance);
      }
      return { ...row };
    }),
  };

  const transactionApi = {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `txn-${nextTxnId++}`, ...data };
      transactions.push(row);
      return row;
    }),
  };

  const tx = { salaryRecord: salaryRecordApi, account: accountApi, transaction: transactionApi };

  const prisma = {
    ...tx,
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  } as unknown as PrismaService;

  function seedAccount(id: string, overrides: Record<string, unknown> = {}) {
    accounts.set(id, { id, societyId: SOCIETY_ID, currentBalance: new Prisma.Decimal(100000), ...overrides });
    return accounts.get(id);
  }

  function seedSalary(id: string, overrides: Record<string, unknown> = {}) {
    const row = {
      id,
      societyId: SOCIETY_ID,
      employeeId: 'employee-1',
      salaryMonth: 9,
      salaryYear: 2026,
      baseSalary: new Prisma.Decimal(50000),
      additions: new Prisma.Decimal(0),
      deductions: new Prisma.Decimal(0),
      netSalary: new Prisma.Decimal(50000),
      accountId: 'account-1',
      status: SalaryStatus.PROCESSED,
      paymentDate: null,
      processedAt: null,
      ...overrides,
    };
    salaryRecords.set(id, row);
    return row;
  }

  return { prisma, salaryRecords, accounts, transactions, seedAccount, seedSalary };
}

describe('SalariesService.paySalary — normal flow', () => {
  it('pays a DRAFT/PROCESSED salary: debits the account, writes one ledger row, marks PAID', async () => {
    const { prisma, seedAccount, seedSalary, transactions } = makeStatefulPrisma();
    seedAccount('account-1');
    seedSalary('salary-1');
    const service = new SalariesService(prisma);

    const result = await service.paySalary(SOCIETY_ID, 'salary-1', ACTOR_ID);

    expect(result!.status).toBe(SalaryStatus.PAID);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ accountId: 'account-1', transactionType: 'DEBIT', linkedEntityId: 'salary-1' });
  });

  it('debits exactly the net salary amount, in Decimal, not a float-rounded approximation', async () => {
    const { prisma, seedAccount, seedSalary, accounts } = makeStatefulPrisma();
    seedAccount('account-1', { currentBalance: new Prisma.Decimal('100000.33') });
    seedSalary('salary-1', { netSalary: new Prisma.Decimal('50000.11') });
    const service = new SalariesService(prisma);

    await service.paySalary(SOCIETY_ID, 'salary-1', ACTOR_ID);

    expect(accounts.get('account-1').currentBalance.toString()).toBe('50000.22');
  });

  it('rejects a missing salary record', async () => {
    const { prisma } = makeStatefulPrisma();
    const service = new SalariesService(prisma);
    await expect(service.paySalary(SOCIETY_ID, 'nope', ACTOR_ID)).rejects.toThrow(NotFoundException);
  });

  it('rejects a salary with no account set', async () => {
    const { prisma, seedSalary } = makeStatefulPrisma();
    seedSalary('salary-1', { accountId: null });
    const service = new SalariesService(prisma);
    await expect(service.paySalary(SOCIETY_ID, 'salary-1', ACTOR_ID)).rejects.toThrow('Account not set');
  });

  it("rejects an account belonging to a different society, even if the salary record's own societyId matches", async () => {
    const { prisma, seedAccount, seedSalary } = makeStatefulPrisma();
    seedAccount('account-1', { societyId: OTHER_SOCIETY_ID });
    seedSalary('salary-1', { accountId: 'account-1' });
    const service = new SalariesService(prisma);
    await expect(service.paySalary(SOCIETY_ID, 'salary-1', ACTOR_ID)).rejects.toThrow(NotFoundException);
  });

  it('rejects a CANCELLED salary', async () => {
    const { prisma, seedAccount, seedSalary } = makeStatefulPrisma();
    seedAccount('account-1');
    seedSalary('salary-1', { status: SalaryStatus.CANCELLED });
    const service = new SalariesService(prisma);
    await expect(service.paySalary(SOCIETY_ID, 'salary-1', ACTOR_ID)).rejects.toThrow(BadRequestException);
  });
});

describe('SalariesService.paySalary — idempotent retry', () => {
  it('an already-PAID salary returns the existing result instead of erroring or paying again', async () => {
    const { prisma, seedAccount, seedSalary, accounts, transactions } = makeStatefulPrisma();
    seedAccount('account-1');
    seedSalary('salary-1', { status: SalaryStatus.PAID, paymentDate: new Date('2026-09-01') });
    const service = new SalariesService(prisma);

    const result = await service.paySalary(SOCIETY_ID, 'salary-1', ACTOR_ID);

    expect(result!.status).toBe(SalaryStatus.PAID);
    expect(accounts.get('account-1').currentBalance.toString()).toBe('100000'); // untouched
    expect(transactions).toHaveLength(0); // no new ledger row
  });
});

describe('SalariesService.paySalary — concurrency', () => {
  it(
    'two concurrent paySalary() calls for the same record: exactly one debit, one ledger row, one PAID salary — ' +
      'account ends at initial minus ONE net salary, not two',
    async () => {
      const { prisma, seedAccount, seedSalary, accounts, transactions, salaryRecords } = makeStatefulPrisma();
      seedAccount('account-1', { currentBalance: new Prisma.Decimal(100000) });
      seedSalary('salary-1', { netSalary: new Prisma.Decimal(50000) });
      const service = new SalariesService(prisma);

      const results = await Promise.allSettled([
        service.paySalary(SOCIETY_ID, 'salary-1', ACTOR_ID),
        service.paySalary(SOCIETY_ID, 'salary-1', ACTOR_ID),
      ]);

      // Both may resolve — the second is the idempotent "already PAID" path,
      // not a rejection — but only one of them actually moved money.
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      expect(accounts.get('account-1').currentBalance.toString()).toBe('50000'); // NOT 0
      expect(transactions).toHaveLength(1); // NOT 2
      expect(salaryRecords.get('salary-1').status).toBe(SalaryStatus.PAID);
    },
  );

  it('five concurrent paySalary() calls for the same record: still exactly one debit and one ledger row', async () => {
    const { prisma, seedAccount, seedSalary, accounts, transactions } = makeStatefulPrisma();
    seedAccount('account-1', { currentBalance: new Prisma.Decimal(100000) });
    seedSalary('salary-1', { netSalary: new Prisma.Decimal(50000) });
    const service = new SalariesService(prisma);

    await Promise.allSettled(
      Array.from({ length: 5 }, () => service.paySalary(SOCIETY_ID, 'salary-1', ACTOR_ID)),
    );

    expect(accounts.get('account-1').currentBalance.toString()).toBe('50000');
    expect(transactions).toHaveLength(1);
  });

  it('a claim that loses the race never touches the account, even though it read DRAFT/PROCESSED first', async () => {
    const { prisma, seedAccount, seedSalary } = makeStatefulPrisma();
    seedAccount('account-1', { currentBalance: new Prisma.Decimal(100000) });
    seedSalary('salary-1', { netSalary: new Prisma.Decimal(50000) });
    const service = new SalariesService(prisma);

    await Promise.allSettled([
      service.paySalary(SOCIETY_ID, 'salary-1', ACTOR_ID),
      service.paySalary(SOCIETY_ID, 'salary-1', ACTOR_ID),
    ]);

    // decrement is applied exactly once — this is really the same
    // assertion as the balance check above, stated in terms of the write
    // count rather than the arithmetic result.
    expect((prisma.account.update as jest.Mock).mock.calls).toHaveLength(1);
  });
});
