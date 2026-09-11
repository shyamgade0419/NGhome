import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, TransactionType, AuditAction } from '@prisma/client';
import { ContributeFundDto } from './dto/contribute-fund.dto';

import { CreateFundDto } from './dto/create-fund.dto';
export { CreateFundDto } from './dto/create-fund.dto';

@Injectable()
export class FundsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(societyId: string, dto: CreateFundDto) {
    if (dto.accountId) {
      const account = await this.prisma.account.findFirst({ where: { id: dto.accountId, societyId } });
      if (!account) throw new NotFoundException('Account not found in this society');
    }

    return this.prisma.fund.create({
      data: {
        societyId,
        name: dto.name,
        description: dto.description,
        accountId: dto.accountId,
        openingBalance: dto.openingBalance
          ? new Prisma.Decimal(dto.openingBalance)
          : new Prisma.Decimal(0),
        currentBalance: dto.openingBalance
          ? new Prisma.Decimal(dto.openingBalance)
          : new Prisma.Decimal(0),
        isVisibleToResidents: dto.isVisibleToResidents ?? false,
      },
    });
  }

  async findAll(societyId: string, forResident = false) {
    return this.prisma.fund.findMany({
      where: {
        societyId,
        isActive: true,
        ...(forResident ? { isVisibleToResidents: true } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(societyId: string, id: string, forResident = false) {
    const fund = await this.prisma.fund.findFirst({
      where: {
        id,
        societyId,
        // DEFECT-7: Residents cannot access non-resident-visible funds by direct ID
        ...(forResident ? { isVisibleToResidents: true } : {}),
      },
    });
    if (!fund) throw new NotFoundException('Fund not found');
    return fund;
  }

  /**
   * Adds money to a fund.
   *
   * Until this existed, `currentBalance` was written in exactly two places —
   * set once from `openingBalance` at creation, and decremented when an
   * event's cost was recorded — with no increment anywhere in the codebase.
   * A corpus fund was therefore frozen at whatever it was created with and
   * could only ever drain: resident contributions, the ordinary way a corpus
   * grows, could not be recorded at all. `update()` deliberately excludes the
   * balance fields, so even a mistyped opening balance was uncorrectable.
   *
   * Mirrors how payments credit an account: atomic `increment` rather than
   * read-modify-write, inside a transaction, writing a Transaction row with
   * `balanceAfter` so the ledger explains the balance.
   *
   * `dto.accountId` decides whether the bank balance moves too — see the DTO,
   * where the double-counting trade-off is spelled out.
   */
  async contribute(societyId: string, id: string, dto: ContributeFundDto, actorId: string) {
    const fund = await this.findOne(societyId, id);

    return this.prisma.$transaction(async (tx) => {
      const amount = new Prisma.Decimal(dto.amount);
      const when = dto.contributionDate ? new Date(dto.contributionDate) : new Date();

      const updatedFund = await tx.fund.update({
        where: { id: fund.id },
        data: { currentBalance: { increment: amount } },
      });

      let creditedAccountId: string | null = null;
      if (dto.accountId) {
        // Checked against the society rather than trusted from the body —
        // otherwise this is a cross-tenant write primitive.
        const account = await tx.account.findFirst({
          where: { id: dto.accountId, societyId },
        });
        if (!account) throw new NotFoundException('Account not found');

        await tx.account.update({
          where: { id: account.id },
          data: { currentBalance: { increment: amount } },
        });
        creditedAccountId = account.id;
      }

      await tx.transaction.create({
        data: {
          societyId,
          fundId: fund.id,
          // Only the account we actually moved. Recording the fund's linked
          // account here when it wasn't credited would make the account
          // ledger disagree with the account balance.
          accountId: creditedAccountId,
          transactionType: TransactionType.CREDIT,
          amount,
          transactionDate: when,
          description: dto.description?.trim() || `Contribution to ${fund.name}`,
          linkedEntityType: 'FUND_CONTRIBUTION',
          linkedEntityId: fund.id,
          balanceAfter: updatedFund.currentBalance,
          createdById: actorId,
        },
      });

      await tx.auditLog.create({
        data: {
          societyId,
          actorId,
          action: AuditAction.FUND_TRANSACTION,
          entityType: 'Fund',
          entityId: fund.id,
          newValues: {
            type: 'CONTRIBUTION',
            amount: amount.toString(),
            balanceBefore: fund.currentBalance.toString(),
            balanceAfter: updatedFund.currentBalance.toString(),
            creditedAccountId,
          },
        },
      });

      return updatedFund;
    });
  }

  async update(societyId: string, id: string, dto: Partial<CreateFundDto>) {
    await this.findOne(societyId, id);
    if (dto.accountId) {
      const account = await this.prisma.account.findFirst({ where: { id: dto.accountId, societyId } });
      if (!account) throw new NotFoundException('Account not found in this society');
    }
    return this.prisma.fund.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        accountId: dto.accountId,
        isVisibleToResidents: dto.isVisibleToResidents,
      },
    });
  }
}
