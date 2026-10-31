import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RefundAdvanceDto } from './dto/refund-advance.dto';

/**
 * Advance credit held by flats, and paying it back.
 *
 * A refund moves money, so it does everything a payment out should: it takes the amount out of the credit
 * (which can never go below zero), out of the chosen account (which must hold it), writes the ledger
 * transaction, and the audit entry, all in one transaction — there is no state where the flat's credit is
 * gone but the account was not debited, or the other way round.
 */
@Injectable()
export class AdvanceCreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Flats that hold an advance, largest first. */
  async list(societyId: string) {
    const flats = await this.prisma.flat.findMany({
      where: { societyId, deletedAt: null, creditBalance: { gt: 0 } },
      orderBy: { creditBalance: 'desc' },
      select: {
        id: true,
        flatCode: true,
        creditBalance: true,
        memberships: {
          where: { status: 'ACTIVE', role: 'RESIDENT' },
          take: 1,
          select: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    const total = flats.reduce((t, f) => t.plus(f.creditBalance), new Prisma.Decimal(0));
    return {
      total: total.toString(),
      flats: flats.map((f) => {
        const user = f.memberships[0]?.user;
        return {
          flatId: f.id,
          flatCode: f.flatCode,
          residentName: user ? `${user.firstName} ${user.lastName}`.trim() : null,
          balance: f.creditBalance.toString(),
        };
      }),
    };
  }

  async refund(societyId: string, actorId: string, dto: RefundAdvanceDto) {
    const amount = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);

    const done = await this.prisma.$transaction(
      async (tx) => {
        // The flat is locked first, as in settlement, so a payment or a publish at the same moment is
        // ordered before or after this refund, never between.
        await tx.$queryRaw`SELECT id FROM flats WHERE id = ${dto.flatId} AND "societyId" = ${societyId} FOR NO KEY UPDATE`;
        const flat = await tx.flat.findFirst({ where: { id: dto.flatId, societyId, deletedAt: null }, select: { id: true, flatCode: true, creditBalance: true } });
        if (!flat) throw new NotFoundException('Flat not found');
        if (flat.creditBalance.lessThan(amount)) {
          throw new BadRequestException(`This flat holds only ₹${flat.creditBalance.toString()} in advance, so ₹${amount.toString()} cannot be refunded.`);
        }

        // The account must hold the money: taken only if it does, in the same statement that checks it.
        const taken = await tx.account.updateMany({
          where: { id: dto.accountId, societyId, isActive: true, currentBalance: { gte: amount } },
          data: { currentBalance: { decrement: amount } },
        });
        if (taken.count !== 1) {
          const account = await tx.account.findFirst({ where: { id: dto.accountId, societyId, isActive: true }, select: { currentBalance: true, name: true } });
          if (!account) throw new NotFoundException('Account not found');
          throw new BadRequestException(`${account.name} holds only ₹${account.currentBalance.toString()}, so ₹${amount.toString()} cannot be paid out of it.`);
        }
        const account = await tx.account.findUniqueOrThrow({ where: { id: dto.accountId }, select: { currentBalance: true } });

        await tx.transaction.create({
          data: {
            societyId,
            accountId: dto.accountId,
            transactionType: 'DEBIT',
            amount,
            transactionDate: new Date(),
            reference: dto.referenceNumber?.trim() || undefined,
            description: `Advance refunded to flat ${flat.flatCode}: ${dto.reason.trim()}`,
            linkedEntityType: 'ADVANCE_REFUND',
            linkedEntityId: flat.id,
            balanceAfter: account.currentBalance,
            createdById: actorId,
          },
        });
        await tx.flat.update({ where: { id: flat.id }, data: { creditBalance: { decrement: amount } } });
        await tx.flatCreditEntry.create({ data: { societyId, flatId: flat.id, amount: amount.negated(), kind: 'REFUND' } });
        await tx.auditLog.create({
          data: {
            societyId,
            actorId,
            action: 'ACCOUNT_TRANSACTION',
            entityType: 'AdvanceRefund',
            entityId: flat.id,
            newValues: { flat: flat.flatCode, amount: amount.toString(), accountId: dto.accountId, reason: dto.reason.trim(), reference: dto.referenceNumber ?? null } as Prisma.InputJsonValue,
          },
        });
        return { flatId: flat.id, flatCode: flat.flatCode, refunded: amount.toString(), remaining: flat.creditBalance.minus(amount).toString() };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    // Told afterwards and best-effort: a failed notification must not undo a refund that was made.
    const residents = await this.prisma.societyMembership.findMany({
      where: { societyId, flatId: done.flatId, status: 'ACTIVE', role: 'RESIDENT' },
      select: { userId: true },
    });
    if (residents.length > 0) {
      await this.notifications.notifyQuietly(
        () =>
          this.notifications.sendToUsers(societyId, residents.map((r) => r.userId), {
            title: 'Advance refunded',
            body: `₹${done.refunded} of the advance you had paid has been refunded.`,
            type: 'PAYMENT_APPROVED',
          }),
        `advance refund for flat ${done.flatId}`,
      );
    }
    return done;
  }
}
