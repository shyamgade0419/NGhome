import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, EventStatus, ExpenseStatus, TransactionType, AuditAction } from '@prisma/client';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';

const LINKED_ENTITY_TYPE = 'EVENT';

import { CreateEventDto } from './dto/create-event.dto';
export { CreateEventDto } from './dto/create-event.dto';

const FUND_SELECT = { id: true, name: true } satisfies Prisma.FundSelect;
const CREATOR_SELECT = { id: true, firstName: true, lastName: true } satisfies Prisma.UserSelect;

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(societyId: string, createdById: string, dto: CreateEventDto) {
    if (dto.fundId) {
      const fund = await this.prisma.fund.findFirst({ where: { id: dto.fundId, societyId } });
      if (!fund) throw new NotFoundException('Fund not found in this society');
    }

    return this.prisma.event.create({
      data: {
        societyId,
        createdById,
        title: dto.title,
        description: dto.description,
        eventDate: new Date(dto.eventDate),
        fundId: dto.fundId,
        estimatedCost: dto.estimatedCost != null ? new Prisma.Decimal(dto.estimatedCost) : undefined,
        actualCost: dto.actualCost != null ? new Prisma.Decimal(dto.actualCost) : undefined,
        status: dto.status ?? EventStatus.PLANNED,
        isVisibleToResidents: dto.isVisibleToResidents ?? true,
      },
      include: { fund: { select: FUND_SELECT }, createdBy: { select: CREATOR_SELECT } },
    });
  }

  async findAll(societyId: string, page: number, limit: number, forResident = false) {
    const { skip, take } = getPaginationParams({ page, limit });
    const where: Prisma.EventWhereInput = {
      societyId,
      ...(forResident ? { isVisibleToResidents: true } : {}),
    };

    const [events, total] = await Promise.all([
      this.prisma.event.findMany({
        skip,
        take,
        where,
        include: { fund: { select: FUND_SELECT }, createdBy: { select: CREATOR_SELECT } },
        orderBy: { eventDate: 'asc' },
      }),
      this.prisma.event.count({ where }),
    ]);

    const data = await this.withRecordedFlag(societyId, events);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(societyId: string, id: string, forResident = false) {
    const event = await this.prisma.event.findFirst({
      where: {
        id,
        societyId,
        ...(forResident ? { isVisibleToResidents: true } : {}),
      },
      include: { fund: { select: FUND_SELECT }, createdBy: { select: CREATOR_SELECT } },
    });
    if (!event) throw new NotFoundException('Event not found');
    const [withFlag] = await this.withRecordedFlag(societyId, [event]);
    return withFlag;
  }

  /** Single batched query rather than one lookup per event — whether each
   *  event's cost has already been turned into a real Expense
   *  (see recordExpense), so the client can show "Recorded" vs. offer the
   *  action, without a separate round-trip per event. */
  private async withRecordedFlag<T extends { id: string }>(societyId: string, events: T[]) {
    if (events.length === 0) return events.map((e) => ({ ...e, expenseRecorded: false }));
    const recorded = await this.prisma.expense.findMany({
      where: {
        societyId,
        linkedEntityType: LINKED_ENTITY_TYPE,
        linkedEntityId: { in: events.map((e) => e.id) },
      },
      select: { linkedEntityId: true },
    });
    const recordedIds = new Set(recorded.map((r) => r.linkedEntityId));
    return events.map((e) => ({ ...e, expenseRecorded: recordedIds.has(e.id) }));
  }

  async update(societyId: string, id: string, dto: Partial<CreateEventDto>) {
    // findOne (admin context — forResident=false) enforces society scope before updating
    await this.findOne(societyId, id);

    if (dto.fundId) {
      const fund = await this.prisma.fund.findFirst({ where: { id: dto.fundId, societyId } });
      if (!fund) throw new NotFoundException('Fund not found in this society');
    }

    return this.prisma.event.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        eventDate: dto.eventDate ? new Date(dto.eventDate) : undefined,
        fundId: dto.fundId,
        estimatedCost: dto.estimatedCost != null ? new Prisma.Decimal(dto.estimatedCost) : undefined,
        actualCost: dto.actualCost != null ? new Prisma.Decimal(dto.actualCost) : undefined,
        status: dto.status,
        isVisibleToResidents: dto.isVisibleToResidents,
      },
      include: { fund: { select: FUND_SELECT }, createdBy: { select: CREATOR_SELECT } },
    });
  }

  async remove(societyId: string, id: string) {
    await this.findOne(societyId, id);
    await this.prisma.event.delete({ where: { id } });
  }

  /**
   * Turns an event's actualCost from a planning note into a real ledger
   * entry — an Expense (so it shows up in expense-by-category and the
   * monthly overview) plus a Fund-debiting Transaction (so the fund
   * balance actually reflects the spend). Until this is called, linking a
   * Fund to an event is deliberately informational only — see the create/
   * update DTOs and the mobile form's own copy ("doesn't move any money").
   *
   * Explicit action, not automatic on every save of actualCost: an admin
   * often enters a rough actualCost before the real invoice is in hand,
   * and auto-creating financial records (and debiting a fund) every time
   * that estimate is edited would be exactly the kind of surprising money
   * movement this codebase avoids elsewhere (see PaymentsService.approve's
   * atomic status-gated update, same instinct).
   *
   * Idempotent via linkedEntityType/Id, the same generic pattern
   * Document/Transaction already use: calling this twice for the same
   * event throws rather than silently double-booking the expense and
   * double-debiting the fund. Correcting a recorded amount means editing
   * the Expense directly in Accounts, same as any other expense.
   */
  async recordExpense(societyId: string, id: string, actorId: string) {
    const event = await this.findOne(societyId, id);

    if (event.actualCost == null) {
      throw new BadRequestException('Set an actual cost on this event before recording it as an expense.');
    }
    if (!event.fundId) {
      throw new BadRequestException('Link a fund to this event before recording it as an expense.');
    }

    const existing = await this.prisma.expense.findFirst({
      where: { societyId, linkedEntityType: LINKED_ENTITY_TYPE, linkedEntityId: id },
    });
    if (existing) {
      throw new ConflictException(
        'This event\'s cost has already been recorded as an expense. Undo the recording first if the amount was wrong, then record it again.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const fund = await tx.fund.findFirst({ where: { id: event.fundId!, societyId } });
      if (!fund) throw new NotFoundException('Linked fund not found');

      // Same find-or-create-by-unique-name pattern as any other lazily
      // provisioned per-society lookup table in this codebase — no
      // "Events" category needs to exist ahead of time.
      const category = await tx.expenseCategory.upsert({
        where: { societyId_name: { societyId, name: 'Events' } },
        create: { societyId, name: 'Events', description: 'Society events and planned activities' },
        update: {},
      });

      const amount = event.actualCost as Prisma.Decimal;

      const expense = await tx.expense.create({
        data: {
          societyId,
          categoryId: category.id,
          accountId: fund.accountId,
          description: `Event: ${event.title}`,
          amount,
          expenseDate: event.eventDate,
          status: ExpenseStatus.APPROVED,
          createdById: actorId,
          approvedById: actorId,
          approvedAt: new Date(),
          linkedEntityType: LINKED_ENTITY_TYPE,
          linkedEntityId: id,
        },
      });

      const updatedFund = await tx.fund.update({
        where: { id: fund.id },
        data: { currentBalance: { decrement: amount } },
      });

      await tx.transaction.create({
        data: {
          societyId,
          fundId: fund.id,
          accountId: fund.accountId,
          transactionType: TransactionType.DEBIT,
          amount,
          transactionDate: new Date(),
          description: `Event: ${event.title}`,
          linkedEntityType: LINKED_ENTITY_TYPE,
          linkedEntityId: id,
          balanceAfter: updatedFund.currentBalance,
          createdById: actorId,
        },
      });

      await tx.auditLog.create({
        data: {
          societyId,
          actorId,
          action: AuditAction.EXPENSE_CREATED,
          entityType: 'Expense',
          entityId: expense.id,
          newValues: {
            source: 'event',
            eventId: id,
            fundId: fund.id,
            amount: amount.toString(),
          } as Prisma.InputJsonValue,
        },
      });

      return expense;
    });
  }

  /**
   * Undoes recordExpense: removes the expense and puts the money back in the
   * fund.
   *
   * There was no way to undo a recording at all. recordExpense creates the
   * expense already APPROVED, and expenses can only be edited, rejected or
   * deleted while PENDING — so a mis-recorded event cost was permanent, the
   * fund stayed debited forever, and recordExpense refused to run again
   * because a linked expense existed. (The conflict message even told admins
   * to correct the amount in Accounts, which the product cannot do.)
   *
   * The fund to credit comes from the original DEBIT transaction, not from
   * `event.fundId`: the event's linked fund can be edited after recording, and
   * crediting whatever it points at *now* would put the money back in the
   * wrong fund. The transaction is the record of what actually moved.
   *
   * Refuses once the expense is PAID. At that point the money has genuinely
   * left the bank account, and unwinding that is a reversing entry against the
   * account — a different, deliberate accounting act — not the deletion of a
   * mis-click.
   */
  async unrecordExpense(societyId: string, id: string, actorId: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { societyId, linkedEntityType: LINKED_ENTITY_TYPE, linkedEntityId: id },
    });
    if (!expense) {
      throw new NotFoundException('This event has no recorded expense to undo.');
    }
    if (expense.status === ExpenseStatus.PAID) {
      throw new ConflictException(
        'This expense has already been paid from an account, so it can no longer be undone here. ' +
          'Record a correcting entry in Accounts instead.',
      );
    }

    const debit = await this.prisma.transaction.findFirst({
      where: {
        societyId,
        linkedEntityType: LINKED_ENTITY_TYPE,
        linkedEntityId: id,
        transactionType: TransactionType.DEBIT,
      },
      orderBy: { createdAt: 'desc' },
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.expense.delete({ where: { id: expense.id } });

      // A recording always writes a fund debit, but guard anyway rather than
      // crediting an arbitrary fund if that row is somehow missing.
      let restoredBalance: Prisma.Decimal | null = null;
      if (debit?.fundId) {
        const fund = await tx.fund.update({
          where: { id: debit.fundId },
          data: { currentBalance: { increment: debit.amount } },
        });
        restoredBalance = fund.currentBalance;

        await tx.transaction.create({
          data: {
            societyId,
            fundId: debit.fundId,
            // No account is credited: recordExpense never debited one. The
            // account only moves at mark-paid, which this path refuses.
            accountId: null,
            transactionType: TransactionType.CREDIT,
            amount: debit.amount,
            transactionDate: new Date(),
            description: `Reversed: ${expense.description}`,
            linkedEntityType: LINKED_ENTITY_TYPE,
            linkedEntityId: id,
            balanceAfter: fund.currentBalance,
            createdById: actorId,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          societyId,
          actorId,
          action: AuditAction.EXPENSE_MODIFIED,
          entityType: 'Expense',
          entityId: expense.id,
          newValues: {
            source: 'event',
            action: 'UNRECORDED',
            eventId: id,
            fundId: debit?.fundId ?? null,
            amount: expense.amount.toString(),
            fundBalanceAfter: restoredBalance?.toString() ?? null,
          } as Prisma.InputJsonValue,
        },
      });

      return { success: true };
    });
  }
}
