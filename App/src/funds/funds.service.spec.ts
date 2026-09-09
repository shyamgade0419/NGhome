/**
 * DEFECT-7: funds.findOne resident visibility unit tests.
 */

import { FundsService } from './funds.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

const SOCIETY_ID = 'society-x';
const FUND_ID = 'fund-1';

function makeFund(isVisibleToResidents: boolean) {
  return { id: FUND_ID, societyId: SOCIETY_ID, name: 'Test Fund', isActive: true, isVisibleToResidents };
}

function makePrisma(fundResult: unknown) {
  return {
    fund: { findFirst: jest.fn().mockResolvedValue(fundResult) },
  } as unknown as PrismaService;
}

describe('FundsService — findOne resident visibility (DEFECT-7)', () => {
  describe('admin access (forResident = false)', () => {
    it('returns a resident-visible fund', async () => {
      const fund = makeFund(true);
      await expect(new FundsService(makePrisma(fund)).findOne(SOCIETY_ID, FUND_ID, false)).resolves.toEqual(fund);
    });

    it('returns a non-resident-visible fund (admins bypass visibility filter)', async () => {
      const fund = makeFund(false);
      const prisma = makePrisma(fund);
      await expect(new FundsService(prisma).findOne(SOCIETY_ID, FUND_ID, false)).resolves.toEqual(fund);
      // Admin query must NOT include isVisibleToResidents filter
      const [callArg] = (prisma.fund.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where).not.toHaveProperty('isVisibleToResidents');
    });

    it('throws NotFoundException when fund does not exist', async () => {
      await expect(new FundsService(makePrisma(null)).findOne(SOCIETY_ID, FUND_ID, false))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('resident access (forResident = true)', () => {
    it('returns a fund that is visible to residents', async () => {
      const fund = makeFund(true);
      await expect(new FundsService(makePrisma(fund)).findOne(SOCIETY_ID, FUND_ID, true)).resolves.toEqual(fund);
    });

    it('throws NotFoundException for fund not visible to residents', async () => {
      // DB returns null because isVisibleToResidents:true filter excludes it
      await expect(new FundsService(makePrisma(null)).findOne(SOCIETY_ID, FUND_ID, true))
        .rejects.toThrow('Fund not found');
    });

    it('includes isVisibleToResidents:true in DB query when forResident is true', async () => {
      const prisma = makePrisma(makeFund(true));
      await new FundsService(prisma).findOne(SOCIETY_ID, FUND_ID, true);
      const [callArg] = (prisma.fund.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where).toMatchObject({ isVisibleToResidents: true });
    });

    it('omits isVisibleToResidents filter when forResident is false', async () => {
      const prisma = makePrisma(makeFund(false));
      await new FundsService(prisma).findOne(SOCIETY_ID, FUND_ID, false);
      const [callArg] = (prisma.fund.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where).not.toHaveProperty('isVisibleToResidents');
    });
  });

  describe('society scoping', () => {
    it('always filters by societyId regardless of resident flag', async () => {
      const prisma = makePrisma(makeFund(true));
      await new FundsService(prisma).findOne(SOCIETY_ID, FUND_ID, true);
      const [callArg] = (prisma.fund.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where).toMatchObject({ societyId: SOCIETY_ID, id: FUND_ID });
    });
  });
});

/**
 * contribute() — the only path that can ever increase a fund balance.
 * Before it existed, currentBalance was set once at creation and otherwise
 * only decremented, so a corpus fund could never be topped up.
 */

import { Prisma } from '@prisma/client';

const ACCOUNT_ID = 'account-1';
const ACTOR_ID = 'actor-1';

function makeContributePrisma(opts: { fund?: any; account?: any } = {}) {
  // `in` rather than ?? so an explicit { fund: null } means "no such fund"
  // instead of silently falling back to the default one.
  const fund = 'fund' in opts
    ? opts.fund
    : {
        id: FUND_ID,
        societyId: SOCIETY_ID,
        name: 'Corpus Fund',
        isActive: true,
        isVisibleToResidents: true,
        currentBalance: new Prisma.Decimal(1000),
      };
  const tx = {
    fund: {
      update: jest.fn().mockResolvedValue({ ...fund, currentBalance: new Prisma.Decimal(1500) }),
    },
    account: {
      findFirst: jest.fn().mockResolvedValue(
        'account' in opts ? opts.account : { id: ACCOUNT_ID, societyId: SOCIETY_ID },
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    transaction: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    fund: { findFirst: jest.fn().mockResolvedValue(fund) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  } as unknown as PrismaService;
  return { prisma, tx };
}

describe('FundsService — contribute', () => {
  it('increments the fund balance atomically rather than writing a computed value', async () => {
    const { prisma, tx } = makeContributePrisma();
    await new FundsService(prisma).contribute(SOCIETY_ID, FUND_ID, { amount: 500 }, ACTOR_ID);

    expect(tx.fund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: FUND_ID },
        data: { currentBalance: { increment: expect.anything() } },
      }),
    );
  });

  it('does NOT touch any bank account when accountId is omitted', async () => {
    const { prisma, tx } = makeContributePrisma();
    await new FundsService(prisma).contribute(SOCIETY_ID, FUND_ID, { amount: 500 }, ACTOR_ID);

    // The money is already banked; crediting an account here would count it twice.
    expect(tx.account.update).not.toHaveBeenCalled();
    const [txArg] = tx.transaction.create.mock.calls[0];
    expect(txArg.data.accountId).toBeNull();
  });

  it('credits the named bank account when accountId is given', async () => {
    const { prisma, tx } = makeContributePrisma();
    await new FundsService(prisma).contribute(
      SOCIETY_ID,
      FUND_ID,
      { amount: 500, accountId: ACCOUNT_ID },
      ACTOR_ID,
    );

    expect(tx.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ACCOUNT_ID },
        data: { currentBalance: { increment: expect.anything() } },
      }),
    );
    const [txArg] = tx.transaction.create.mock.calls[0];
    expect(txArg.data.accountId).toBe(ACCOUNT_ID);
  });

  it('rejects an account belonging to another society', async () => {
    const { prisma, tx } = makeContributePrisma({ account: null });
    await expect(
      new FundsService(prisma).contribute(
        SOCIETY_ID,
        FUND_ID,
        { amount: 500, accountId: 'someone-elses-account' },
        ACTOR_ID,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(tx.account.update).not.toHaveBeenCalled();
  });

  it('records a CREDIT transaction carrying the resulting balance', async () => {
    const { prisma, tx } = makeContributePrisma();
    await new FundsService(prisma).contribute(
      SOCIETY_ID,
      FUND_ID,
      { amount: 500, description: 'Corpus collection Q3' },
      ACTOR_ID,
    );

    const [txArg] = tx.transaction.create.mock.calls[0];
    expect(txArg.data).toMatchObject({
      societyId: SOCIETY_ID,
      fundId: FUND_ID,
      transactionType: 'CREDIT',
      description: 'Corpus collection Q3',
      linkedEntityType: 'FUND_CONTRIBUTION',
      createdById: ACTOR_ID,
    });
    expect(txArg.data.balanceAfter.toString()).toBe('1500');
  });

  it('writes an audit log with the before and after balances', async () => {
    const { prisma, tx } = makeContributePrisma();
    await new FundsService(prisma).contribute(SOCIETY_ID, FUND_ID, { amount: 500 }, ACTOR_ID);

    const [auditArg] = tx.auditLog.create.mock.calls[0];
    expect(auditArg.data).toMatchObject({ action: 'FUND_TRANSACTION', entityId: FUND_ID });
    expect(auditArg.data.newValues).toMatchObject({
      type: 'CONTRIBUTION',
      balanceBefore: '1000',
      balanceAfter: '1500',
    });
  });

  it('refuses a fund from another society', async () => {
    const { prisma } = makeContributePrisma({ fund: null });
    await expect(
      new FundsService(prisma).contribute(SOCIETY_ID, FUND_ID, { amount: 500 }, ACTOR_ID),
    ).rejects.toThrow(NotFoundException);
  });
});
