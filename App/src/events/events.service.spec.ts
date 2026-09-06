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
