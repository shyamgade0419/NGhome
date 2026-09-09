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
