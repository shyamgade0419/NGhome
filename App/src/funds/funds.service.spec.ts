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
