/**
 * create() category resolution.
 *
 * Both clients send a category *name* from a fixed list ("MAINTENANCE",
 * "UTILITIES", …) because they have no category IDs to hand. create() only
 * ever read dto.categoryId, and categoryId is nullable, so every expense
 * logged from either app was stored uncategorised while the picker appeared
 * to work — the list rendered "—" and the resident expense breakdown reported
 * everything as "Uncategorized".
 */

import { NotFoundException } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../prisma/prisma.service';

const SOCIETY_ID = 'society-x';
const ACTOR_ID = 'user-1';
const CATEGORY_ID = 'category-1';

const baseDto = {
  description: 'Plumber repair work',
  amount: 2500,
  expenseDate: '2026-09-09',
};

function makePrisma() {
  const prisma = {
    expenseCategory: {
      upsert: jest.fn().mockResolvedValue({ id: CATEGORY_ID, name: 'MAINTENANCE' }),
      // A client-supplied categoryId must belong to the caller's own
      // society — see ExpensesService.resolveCategoryId.
      findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve({ id: where.id, societyId: where.societyId })),
    },
    account: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve({ id: where.id, societyId: where.societyId })),
    },
    expense: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'e1', ...data })),
    },
  } as unknown as PrismaService;
  return prisma;
}

describe('ExpensesService — create category resolution', () => {
  it('resolves a category name to a real category and stores it', async () => {
    const prisma = makePrisma();
    await new ExpensesService(prisma).create(SOCIETY_ID, ACTOR_ID, {
      ...baseDto,
      category: 'MAINTENANCE',
    });

    expect(prisma.expenseCategory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { societyId_name: { societyId: SOCIETY_ID, name: 'MAINTENANCE' } },
      }),
    );
    const [createArg] = (prisma.expense.create as jest.Mock).mock.calls[0];
    expect(createArg.data.categoryId).toBe(CATEGORY_ID);
  });

  it('scopes the category to the society, so two societies never share a row', async () => {
    const prisma = makePrisma();
    await new ExpensesService(prisma).create('other-society', ACTOR_ID, {
      ...baseDto,
      category: 'MAINTENANCE',
    });

    const [upsertArg] = (prisma.expenseCategory.upsert as jest.Mock).mock.calls[0];
    expect(upsertArg.where.societyId_name.societyId).toBe('other-society');
  });

  it('prefers an explicit categoryId and does not touch the lookup table', async () => {
    const prisma = makePrisma();
    await new ExpensesService(prisma).create(SOCIETY_ID, ACTOR_ID, {
      ...baseDto,
      categoryId: 'explicit-id',
      category: 'MAINTENANCE',
    });

    expect(prisma.expenseCategory.upsert).not.toHaveBeenCalled();
    const [createArg] = (prisma.expense.create as jest.Mock).mock.calls[0];
    expect(createArg.data.categoryId).toBe('explicit-id');
  });

  it('leaves the expense uncategorised when neither is given', async () => {
    const prisma = makePrisma();
    await new ExpensesService(prisma).create(SOCIETY_ID, ACTOR_ID, baseDto);

    expect(prisma.expenseCategory.upsert).not.toHaveBeenCalled();
    const [createArg] = (prisma.expense.create as jest.Mock).mock.calls[0];
    expect(createArg.data.categoryId).toBeUndefined();
  });

  it('treats a blank or whitespace category as not given', async () => {
    const prisma = makePrisma();
    await new ExpensesService(prisma).create(SOCIETY_ID, ACTOR_ID, { ...baseDto, category: '   ' });

    expect(prisma.expenseCategory.upsert).not.toHaveBeenCalled();
    const [createArg] = (prisma.expense.create as jest.Mock).mock.calls[0];
    expect(createArg.data.categoryId).toBeUndefined();
  });

  it('trims the name, so " MAINTENANCE" and "MAINTENANCE" are one category', async () => {
    const prisma = makePrisma();
    await new ExpensesService(prisma).create(SOCIETY_ID, ACTOR_ID, {
      ...baseDto,
      category: '  MAINTENANCE  ',
    });

    const [upsertArg] = (prisma.expenseCategory.upsert as jest.Mock).mock.calls[0];
    expect(upsertArg.where.societyId_name.name).toBe('MAINTENANCE');
  });
});

describe('ExpensesService.create — cross-society foreign keys are rejected', () => {
  it("refuses a categoryId that belongs to a different society, and never creates the expense", async () => {
    const prisma = makePrisma();
    (prisma.expenseCategory.findFirst as jest.Mock).mockResolvedValue(null); // not found in THIS society
    await expect(
      new ExpensesService(prisma).create(SOCIETY_ID, ACTOR_ID, { ...baseDto, categoryId: 'category-from-society-b' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it('refuses an accountId that belongs to a different society, and never creates the expense', async () => {
    const prisma = makePrisma();
    (prisma.account.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(
      new ExpensesService(prisma).create(SOCIETY_ID, ACTOR_ID, { ...baseDto, accountId: 'account-from-society-b' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });
});
