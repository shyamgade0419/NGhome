import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, TransactionType, AuditAction, FundKind } from '@prisma/client';
import { buildFundSummary } from './fund-summary';
import { ContributeFundDto } from './dto/contribute-fund.dto';

import { CreateFundDto } from './dto/create-fund.dto';
export { CreateFundDto } from './dto/create-fund.dto';

@Injectable()
export class FundsService {
  constructor(private readonly prisma: PrismaService) {}

  /** A society keeps one corpus: more money for it goes in with Add Money, not in a second fund. */
  private async assertNoOtherCorpus(societyId: string, exceptId?: string) {
    const existing = await this.prisma.fund.findFirst({
      where: { societyId, kind: FundKind.CORPUS, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { name: true },
    });
    if (existing) {
      throw new ConflictException(
        `This society already has a corpus fund (${existing.name}). Add money to it, or create this one as an Other fund.`,
      );
    }
  }

  async create(societyId: string, dto: CreateFundDto) {
    if (dto.accountId) {
      const account = await this.prisma.account.findFirst({ where: { id: dto.accountId, societyId, isActive: true } });
      if (!account) throw new NotFoundException('Account not found in this society');
    }
    const kind = dto.kind ?? FundKind.OTHER;
    if (kind === FundKind.CORPUS) await this.assertNoOtherCorpus(societyId);

    return this.prisma.fund.create({
      data: {
        societyId,
        kind,
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
          where: { id: dto.accountId, societyId, isActive: true },
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

  /**
   * Where the money is: the bank accounts, the corpus, every other fund and what is left over, with a check
   * that they add up. See fund-summary.ts for why the parts always sum to the bank.
   */
  async summary(societyId: string) {
    const [accounts, funds] = await Promise.all([
      this.prisma.account.findMany({
        where: { societyId, isActive: true },
        select: { id: true, name: true, currentBalance: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.fund.findMany({
        where: { societyId, isActive: true },
        select: { id: true, name: true, kind: true, currentBalance: true, isVisibleToResidents: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return buildFundSummary(accounts, funds);
  }

  async update(societyId: string, id: string, dto: Partial<CreateFundDto>) {
    await this.findOne(societyId, id);
    if (dto.accountId) {
      const account = await this.prisma.account.findFirst({ where: { id: dto.accountId, societyId, isActive: true } });
      if (!account) throw new NotFoundException('Account not found in this society');
    }
    if (dto.kind === FundKind.CORPUS) await this.assertNoOtherCorpus(societyId, id);
    return this.prisma.fund.update({
      where: { id },
      data: {
        kind: dto.kind,
        name: dto.name,
        description: dto.description,
        accountId: dto.accountId,
        isVisibleToResidents: dto.isVisibleToResidents,
      },
    });
  }
}
