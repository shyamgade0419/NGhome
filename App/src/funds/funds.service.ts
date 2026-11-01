import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, TransactionType, AuditAction, FundKind, SystemRole } from '@prisma/client';
import { buildFundSummary } from './fund-summary';
import { ContributeFundDto } from './dto/contribute-fund.dto';
import { AdjustFundDto } from './dto/adjust-fund.dto';

/** Fund balances are Decimal(15,2); this keeps one adjustment far from the edge. */
const MAX_FUND_ADJUSTMENT = new Prisma.Decimal('999999999.99');

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
   * Raises or lowers a fund by hand, with the reason on the record.
   *
   * The fund is an earmark inside the bank accounts, so by default only the earmark moves: the general money
   * rises or falls by the same amount and the bank total stays put. When `accountId` is given the money really
   * entered or left that account, and the account moves with the fund.
   *
   * A fund never goes below zero. Lowering one is the admin's call; raising one is open to the accountant too.
   */
  async adjust(societyId: string, id: string, dto: AdjustFundDto, actor: { id: string; role?: string }) {
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.decimalPlaces() > 2) throw new BadRequestException('An amount can have at most two decimal places.');
    if (amount.gt(MAX_FUND_ADJUSTMENT)) throw new BadRequestException('That amount is too large.');
    const comment = dto.comment.trim();
    if (comment.length < 3) throw new BadRequestException('Add a comment of at least 3 characters saying why.');

    const increase = dto.direction === 'INCREASE';
    if (!increase && actor.role !== SystemRole.SOCIETY_ADMIN) {
      throw new ForbiddenException('Only the admin can take money out of a fund.');
    }

    const when = dto.date ? new Date(dto.date) : new Date();
    if (Number.isNaN(when.getTime())) throw new BadRequestException('That is not a valid date.');

    const fund = await this.prisma.fund.findFirst({ where: { id, societyId, isActive: true } });
    if (!fund) throw new NotFoundException('Fund not found');

    return this.prisma.$transaction(async (tx) => {
      const moved = await tx.fund.updateMany({
        where: increase ? { id: fund.id } : { id: fund.id, currentBalance: { gte: amount } },
        data: { currentBalance: increase ? { increment: amount } : { decrement: amount } },
      });
      if (moved.count === 0) {
        const now = await tx.fund.findUniqueOrThrow({ where: { id: fund.id }, select: { currentBalance: true } });
        throw new BadRequestException(`${fund.name} holds only ₹${now.currentBalance.toFixed(2)}, so ₹${amount.toFixed(2)} cannot be taken out.`);
      }
      const updatedFund = await tx.fund.findUniqueOrThrow({ where: { id: fund.id } });

      let accountId: string | null = null;
      if (dto.accountId) {
        const account = await tx.account.findFirst({ where: { id: dto.accountId, societyId, isActive: true } });
        if (!account) throw new NotFoundException('Account not found');
        await tx.account.update({
          where: { id: account.id },
          data: { currentBalance: increase ? { increment: amount } : { decrement: amount } },
        });
        accountId = account.id;
      }

      await tx.transaction.create({
        data: {
          societyId,
          fundId: fund.id,
          accountId,
          transactionType: increase ? TransactionType.CREDIT : TransactionType.DEBIT,
          amount,
          transactionDate: when,
          description: `${increase ? 'Added to' : 'Taken from'} ${fund.name}: ${comment}`,
          linkedEntityType: 'FUND_ADJUSTMENT',
          linkedEntityId: fund.id,
          balanceAfter: updatedFund.currentBalance,
          createdById: actor.id,
        },
      });

      await tx.auditLog.create({
        data: {
          societyId,
          actorId: actor.id,
          action: AuditAction.FUND_TRANSACTION,
          entityType: 'Fund',
          entityId: fund.id,
          newValues: {
            type: increase ? 'INCREASE' : 'DECREASE',
            amount: amount.toString(),
            comment,
            balanceBefore: fund.currentBalance.toString(),
            balanceAfter: updatedFund.currentBalance.toString(),
            accountId,
          },
        },
      });

      return updatedFund;
    });
  }

  /**
   * Everything that has moved a fund since it was opened, newest first: contributions, hand adjustments with
   * their comments, and expenses paid out of it. The opening balance is not an entry; it is where it started.
   */
  async history(societyId: string, id: string) {
    const fund = await this.prisma.fund.findFirst({ where: { id, societyId } });
    if (!fund) throw new NotFoundException('Fund not found');

    const rows = await this.prisma.transaction.findMany({
      where: { societyId, fundId: id },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    const ids = [...new Set(rows.map((r) => r.createdById).filter((v): v is string => !!v))];
    const people = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nameOf = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));

    return {
      fund: { id: fund.id, name: fund.name, openingBalance: fund.openingBalance.toFixed(2), currentBalance: fund.currentBalance.toFixed(2) },
      entries: rows.map((r) => ({
        id: r.id,
        date: r.transactionDate,
        direction: r.transactionType === TransactionType.CREDIT ? 'IN' : 'OUT',
        amount: r.amount.toFixed(2),
        description: r.description,
        movedBankAccount: !!r.accountId,
        by: r.createdById ? (nameOf.get(r.createdById) ?? null) : null,
      })),
    };
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
