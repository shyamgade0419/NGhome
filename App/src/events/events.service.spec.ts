/**
 * Event.actualCost/fundId were purely informational — linking a fund never
 * moved money (documented deliberately in the mobile form's own copy).
 * recordExpense() is the explicit action that turns that into a real
 * ledger entry. These tests lock in its idempotency and validation, since
 * a bug here means double-booking an expense or double-debiting a fund.
 */

import { EventsService } from './events.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const SOCIETY_ID = 'society-a';
const EVENT_ID = 'event-1';
const FUND_ID = 'fund-1';
const ACTOR_ID = 'admin-1';

function makeEvent(overrides: Partial<{ actualCost: Prisma.Decimal | null; fundId: string | null }> = {}) {
  return {
    id: EVENT_ID,
    societyId: SOCIETY_ID,
    title: 'Diwali Celebration',
    eventDate: new Date('2026-10-20'),
    fundId: FUND_ID,
    actualCost: new Prisma.Decimal(25000),
    ...overrides,
  };
}

function makePrisma(opts: {
  event: ReturnType<typeof makeEvent>;
  existingExpense?: unknown;
  fund?: { id: string; accountId: string | null; currentBalance: Prisma.Decimal } | null;
}) {
  const fund = 'fund' in opts ? opts.fund : { id: FUND_ID, accountId: 'account-1', currentBalance: new Prisma.Decimal(100000) };
  const expenseCreate = jest.fn().mockResolvedValue({ id: 'expense-1' });
  const fundUpdate = jest.fn().mockResolvedValue(
    fund ? { ...fund, currentBalance: fund.currentBalance.minus(25000) } : null,
  );
  const transactionCreate = jest.fn().mockResolvedValue({ id: 'txn-1' });
  const auditLogCreate = jest.fn().mockResolvedValue({});
  const categoryUpsert = jest.fn().mockResolvedValue({ id: 'cat-events' });

  const tx = {
    fund: { findFirst: jest.fn().mockResolvedValue(fund), update: fundUpdate },
    expenseCategory: { upsert: categoryUpsert },
    expense: { create: expenseCreate },
    transaction: { create: transactionCreate },
    auditLog: { create: auditLogCreate },
  };

  return {
    event: { findFirst: jest.fn().mockResolvedValue(opts.event) },
    expense: {
      findFirst: jest.fn().mockResolvedValue(opts.existingExpense ?? null),
      // Backs findOne()'s batched "already recorded?" flag, unrelated to
      // the existing-expense check above (a separate, more specific query).
      findMany: jest.fn().mockResolvedValue(opts.existingExpense ? [{ linkedEntityId: EVENT_ID }] : []),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
    __tx: tx,
  } as unknown as PrismaService & { __tx: typeof tx };
}

describe('EventsService.recordExpense', () => {
  it('rejects when the event has no actualCost', async () => {
    const prisma = makePrisma({ event: makeEvent({ actualCost: null }) });
    const service = new EventsService(prisma);
    await expect(service.recordExpense(SOCIETY_ID, EVENT_ID, ACTOR_ID)).rejects.toThrow(BadRequestException);
  });

  it('rejects when the event has no linked fund', async () => {
    const prisma = makePrisma({ event: makeEvent({ fundId: null }) });
    const service = new EventsService(prisma);
    await expect(service.recordExpense(SOCIETY_ID, EVENT_ID, ACTOR_ID)).rejects.toThrow(BadRequestException);
  });

  it('rejects a second recording attempt (idempotent via linkedEntityType/Id)', async () => {
    const prisma = makePrisma({ event: makeEvent(), existingExpense: { id: 'expense-already' } });
    const service = new EventsService(prisma);
    await expect(service.recordExpense(SOCIETY_ID, EVENT_ID, ACTOR_ID)).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException if the linked fund no longer exists', async () => {
    const prisma = makePrisma({ event: makeEvent(), fund: null });
    const service = new EventsService(prisma);
    await expect(service.recordExpense(SOCIETY_ID, EVENT_ID, ACTOR_ID)).rejects.toThrow(NotFoundException);
  });

  it('creates an APPROVED Expense linked to the event, debits the fund, and logs a Transaction', async () => {
    const prisma = makePrisma({ event: makeEvent() });
    const service = new EventsService(prisma);

    await service.recordExpense(SOCIETY_ID, EVENT_ID, ACTOR_ID);

    expect(prisma.__tx.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          societyId: SOCIETY_ID,
          status: 'APPROVED',
          linkedEntityType: 'EVENT',
          linkedEntityId: EVENT_ID,
          description: 'Event: Diwali Celebration',
        }),
      }),
    );
    expect(prisma.__tx.fund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: FUND_ID },
        data: { currentBalance: { decrement: expect.any(Prisma.Decimal) } },
      }),
    );
    expect(prisma.__tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transactionType: 'DEBIT',
          fundId: FUND_ID,
          linkedEntityType: 'EVENT',
          linkedEntityId: EVENT_ID,
        }),
      }),
    );
  });
});

/**
 * unrecordExpense — the undo that did not exist.
 *
 * recordExpense creates the expense already APPROVED, and expenses can only
 * be edited, rejected or deleted while PENDING, so a mis-recorded event cost
 * was permanent: the fund stayed debited and recordExpense refused to run
 * again because a linked expense existed.
 */

const EXPENSE_ID = 'expense-1';

function makeUnrecordPrisma(opts: {
  expense?: unknown;
  debit?: unknown;
} = {}) {
  const expense =
    'expense' in opts
      ? opts.expense
      : {
          id: EXPENSE_ID,
          societyId: SOCIETY_ID,
          description: 'Event: Diwali Celebration',
          amount: new Prisma.Decimal(25000),
          status: 'APPROVED',
        };
  const debit =
    'debit' in opts
      ? opts.debit
      : { id: 'txn-1', fundId: FUND_ID, amount: new Prisma.Decimal(25000) };

  const tx = {
    expense: { delete: jest.fn().mockResolvedValue({}) },
    fund: {
      update: jest.fn().mockResolvedValue({ id: FUND_ID, currentBalance: new Prisma.Decimal(125000) }),
    },
    transaction: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    expense: { findFirst: jest.fn().mockResolvedValue(expense) },
    transaction: { findFirst: jest.fn().mockResolvedValue(debit) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  } as unknown as PrismaService;

  return { prisma, tx };
}

describe('EventsService — unrecordExpense', () => {
  it('deletes the expense and credits the fund back by the same amount', async () => {
    const { prisma, tx } = makeUnrecordPrisma();
    await new EventsService(prisma).unrecordExpense(SOCIETY_ID, EVENT_ID, ACTOR_ID);

    expect(tx.expense.delete).toHaveBeenCalledWith({ where: { id: EXPENSE_ID } });
    expect(tx.fund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: FUND_ID },
        data: { currentBalance: { increment: expect.anything() } },
      }),
    );
    const [fundArg] = tx.fund.update.mock.calls[0];
    expect(fundArg.data.currentBalance.increment.toString()).toBe('25000');
  });

  it('credits the fund the debit actually hit, not whatever the event points at now', async () => {
    // The event's linked fund can be edited after recording; crediting that
    // would put the money back in the wrong fund.
    const { prisma, tx } = makeUnrecordPrisma({
      debit: { id: 'txn-1', fundId: 'the-fund-that-was-debited', amount: new Prisma.Decimal(25000) },
    });
    await new EventsService(prisma).unrecordExpense(SOCIETY_ID, EVENT_ID, ACTOR_ID);

    const [fundArg] = tx.fund.update.mock.calls[0];
    expect(fundArg.where.id).toBe('the-fund-that-was-debited');
  });

  it('writes a reversing CREDIT transaction carrying the restored balance', async () => {
    const { prisma, tx } = makeUnrecordPrisma();
    await new EventsService(prisma).unrecordExpense(SOCIETY_ID, EVENT_ID, ACTOR_ID);

    const [txArg] = tx.transaction.create.mock.calls[0];
    expect(txArg.data).toMatchObject({
      societyId: SOCIETY_ID,
      fundId: FUND_ID,
      transactionType: 'CREDIT',
      linkedEntityType: 'EVENT',
      linkedEntityId: EVENT_ID,
      createdById: ACTOR_ID,
    });
    // No account is credited — recordExpense never debited one.
    expect(txArg.data.accountId).toBeNull();
    expect(txArg.data.balanceAfter.toString()).toBe('125000');
  });

  it('refuses once the expense has been paid from an account', async () => {
    const { prisma, tx } = makeUnrecordPrisma({
      expense: {
        id: EXPENSE_ID,
        societyId: SOCIETY_ID,
        description: 'Event: Diwali Celebration',
        amount: new Prisma.Decimal(25000),
        status: 'PAID',
      },
    });

    await expect(
      new EventsService(prisma).unrecordExpense(SOCIETY_ID, EVENT_ID, ACTOR_ID),
    ).rejects.toThrow(ConflictException);
    expect(tx.expense.delete).not.toHaveBeenCalled();
    expect(tx.fund.update).not.toHaveBeenCalled();
  });

  it('throws when the event has no recorded expense', async () => {
    const { prisma, tx } = makeUnrecordPrisma({ expense: null });

    await expect(
      new EventsService(prisma).unrecordExpense(SOCIETY_ID, EVENT_ID, ACTOR_ID),
    ).rejects.toThrow(NotFoundException);
    expect(tx.expense.delete).not.toHaveBeenCalled();
  });

  it('still removes the expense if the debit transaction is missing, without crediting a guessed fund', async () => {
    const { prisma, tx } = makeUnrecordPrisma({ debit: null });
    await new EventsService(prisma).unrecordExpense(SOCIETY_ID, EVENT_ID, ACTOR_ID);

    expect(tx.expense.delete).toHaveBeenCalled();
    expect(tx.fund.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('records the undo in the audit log', async () => {
    const { prisma, tx } = makeUnrecordPrisma();
    await new EventsService(prisma).unrecordExpense(SOCIETY_ID, EVENT_ID, ACTOR_ID);

    const [auditArg] = tx.auditLog.create.mock.calls[0];
    expect(auditArg.data.newValues).toMatchObject({
      source: 'event',
      action: 'UNRECORDED',
      eventId: EVENT_ID,
      fundId: FUND_ID,
    });
  });
});

describe('EventsService.create/update — cross-society fundId is rejected', () => {
  function makeWritePrisma(fundResult: unknown) {
    return {
      fund: { findFirst: jest.fn().mockResolvedValue(fundResult) },
      event: {
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: EVENT_ID, ...data })),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: EVENT_ID, ...data })),
        findFirst: jest.fn().mockResolvedValue(makeEvent()),
      },
      // update() calls findOne() first, which also flags whether the event's
      // cost has already been turned into an Expense — irrelevant here, but
      // findOne would throw on a missing mock method without this.
      expense: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
  }

  it('create(): refuses a fundId from another society, and never creates the event', async () => {
    const prisma = makeWritePrisma(null);
    await expect(
      new EventsService(prisma).create(SOCIETY_ID, ACTOR_ID, {
        title: 'AGM',
        eventDate: '2026-11-01',
        fundId: 'fund-from-society-b',
      } as any),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('create(): accepts a fundId that genuinely belongs to this society', async () => {
    const prisma = makeWritePrisma({ id: FUND_ID, societyId: SOCIETY_ID });
    await new EventsService(prisma).create(SOCIETY_ID, ACTOR_ID, {
      title: 'AGM',
      eventDate: '2026-11-01',
      fundId: FUND_ID,
    } as any);
    expect(prisma.event.create).toHaveBeenCalled();
  });

  it('update(): refuses a fundId from another society, and never updates the event', async () => {
    const prisma = makeWritePrisma(null);
    await expect(
      new EventsService(prisma).update(SOCIETY_ID, EVENT_ID, { fundId: 'fund-from-society-b' } as any),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.event.update).not.toHaveBeenCalled();
  });
});
