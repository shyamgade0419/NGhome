/**
 * getTransactions() used to return {data, total, page, limit} — a shape
 * TransformInterceptor doesn't recognise as pagination (it only auto-unwraps
 * {data, meta}). That silently double-wrapped the response: every client's
 * response.data.data held this whole object instead of the transaction
 * array, so the ledger rendered empty no matter how many transactions
 * actually existed for the account. See TransformInterceptor's own spec for
 * the interceptor-side half of this contract.
 */

import { AccountsService } from './accounts.service';
import { PrismaService } from '../prisma/prisma.service';

const SOCIETY_ID = 'society-x';
const ACCOUNT_ID = 'account-1';

function makePrisma(transactions: any[], total: number) {
  return {
    account: {
      findFirst: jest.fn().mockResolvedValue({ id: ACCOUNT_ID, societyId: SOCIETY_ID }),
    },
    transaction: {
      findMany: jest.fn().mockResolvedValue(transactions),
      count: jest.fn().mockResolvedValue(total),
    },
  } as unknown as PrismaService;
}

describe('AccountsService.getTransactions', () => {
  it('returns {data, meta} — the shape TransformInterceptor actually unwraps', async () => {
    const rows = [{ id: 't1' }, { id: 't2' }];
    const prisma = makePrisma(rows, 2);

    const result = await new AccountsService(prisma).getTransactions(SOCIETY_ID, ACCOUNT_ID, 1, 20);

    expect(result).toEqual({
      data: rows,
      meta: {
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
    // The old shape had these as siblings of `data`, not nested under `meta`.
    expect(result).not.toHaveProperty('total');
    expect(result).not.toHaveProperty('page');
    expect(result).not.toHaveProperty('limit');
  });

  it('scopes the query to the given society and account, and paginates', async () => {
    const prisma = makePrisma([], 45);

    await new AccountsService(prisma).getTransactions(SOCIETY_ID, ACCOUNT_ID, 3, 10);

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { societyId: SOCIETY_ID, accountId: ACCOUNT_ID },
        skip: 20,
        take: 10,
      }),
    );
  });
});
