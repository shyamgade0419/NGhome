import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ExpenseStatus } from '@prisma/client';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';

export interface CreateExpenseDto {
  categoryId?: string;
  /**
   * Category by name, which is what both clients actually send — they offer a
   * fixed list ("MAINTENANCE", "UTILITIES", …) and have no category IDs to
   * hand. Only `categoryId` was read before, so every expense logged from
   * either app was stored uncategorised and the picker did nothing: the list
   * showed "—" and the resident expense breakdown reported everything as
   * "Uncategorized". Resolved to a real category below.
   */
  category?: string;
  accountId?: string;
  vendorPayee?: string;
  description: string;
  amount: number;
  expenseDate: string;
  invoiceNumber?: string;
  referenceNumber?: string;
  isRecurring?: boolean;
  notes?: string;
}

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find-or-create a category by name, scoped to the society. Same pattern as
   * EventsService.recordExpense — categories are a lazily provisioned per-
   * society lookup, so a society never has to seed them before logging an
   * expense, and two expenses in the same category always land on one row
   * (@@unique([societyId, name])).
   */
  private async resolveCategoryId(
    societyId: string,
    dto: CreateExpenseDto,
  ): Promise<string | undefined> {
    if (dto.categoryId) return dto.categoryId;

    const name = dto.category?.trim();
    if (!name) return undefined;

    const category = await this.prisma.expenseCategory.upsert({
      where: { societyId_name: { societyId, name } },
      create: { societyId, name },
      update: {},
    });
    return category.id;
  }

  async create(societyId: string, createdById: string, dto: CreateExpenseDto) {
    const categoryId = await this.resolveCategoryId(societyId, dto);

    return this.prisma.expense.create({
      data: {
        societyId,
        createdById,
        categoryId,
        accountId: dto.accountId,
        vendorPayee: dto.vendorPayee,
        description: dto.description,
        amount: new Prisma.Decimal(dto.amount),
        expenseDate: new Date(dto.expenseDate),
        invoiceNumber: dto.invoiceNumber,
        referenceNumber: dto.referenceNumber,
        isRecurring: dto.isRecurring ?? false,
        notes: dto.notes,
        status: ExpenseStatus.PENDING,
      },
    });
  }

  async findAll(societyId: string, page: number, limit: number, status?: ExpenseStatus) {
    const { skip, take } = getPaginationParams({ page, limit });
    const where: Prisma.ExpenseWhereInput = {
      societyId,
      ...(status ? { status } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.expense.findMany({
        skip,
        take,
        where,
        include: {
          category: { select: { id: true, name: true } },
          account: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { expenseDate: 'desc' },
      }),
      this.prisma.expense.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(societyId: string, id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, societyId },
      include: {
        category: true,
        account: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  async approve(societyId: string, expenseId: string, approvedById: string) {
    // Fetch for scope verification; status gate moves inside the transaction
    await this.findOne(societyId, expenseId);

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.expense.updateMany({
        where: { id: expenseId, status: ExpenseStatus.PENDING },
        data: {
          status: ExpenseStatus.APPROVED,
          approvedById,
          approvedAt: new Date(),
        },
      });
      if (count === 0) {
        throw new ForbiddenException('Only pending expenses can be approved');
      }

      await tx.auditLog.create({
        data: {
          societyId,
          actorId: approvedById,
          action: 'EXPENSE_APPROVED',
          entityType: 'Expense',
          entityId: expenseId,
        },
      });

      return tx.expense.findUnique({ where: { id: expenseId } });
    });
  }

  async reject(societyId: string, expenseId: string, reason: string, actorId: string) {
    // Fetch for scope verification and to preserve any existing note
    const expense = await this.findOne(societyId, expenseId);

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.expense.updateMany({
        where: { id: expenseId, status: ExpenseStatus.PENDING },
        data: {
          status: ExpenseStatus.REJECTED,
          approvedById: actorId,
          approvedAt: new Date(),
          // There is no dedicated rejectionReason column — append rather than clobber.
          notes: [expense.notes, `Rejected: ${reason}`].filter(Boolean).join(' — '),
        },
      });
      if (count === 0) {
        throw new ForbiddenException('Only pending expenses can be rejected');
      }

      await tx.auditLog.create({
        data: {
          societyId,
          actorId,
          action: 'EXPENSE_REJECTED',
          entityType: 'Expense',
          entityId: expenseId,
        },
      });

      return tx.expense.findUnique({ where: { id: expenseId } });
    });
  }

  async markPaid(societyId: string, expenseId: string, accountId: string, actorId: string) {
    // Fetch expense data for amount; status gate is inside the transaction
    const expense = await this.findOne(societyId, expenseId);

    return this.prisma.$transaction(async (tx) => {
      // 1. Atomic status check-and-update
      const { count } = await tx.expense.updateMany({
        where: { id: expenseId, status: ExpenseStatus.APPROVED },
        data: { status: ExpenseStatus.PAID, paidAt: new Date(), accountId },
      });
      if (count === 0) {
        throw new ForbiddenException('Only approved expenses can be marked as paid');
      }

      // 2. Verify account belongs to society
      const account = await tx.account.findFirst({ where: { id: accountId, societyId } });
      if (!account) throw new NotFoundException('Account not found');

      // 3. Atomic balance decrement — avoids read-modify-write race
      const updatedAccount = await tx.account.update({
        where: { id: accountId },
        data: { currentBalance: { decrement: expense.amount } },
      });

      await tx.transaction.create({
        data: {
          societyId,
          accountId,
          transactionType: 'DEBIT',
          amount: expense.amount,
          transactionDate: new Date(),
          description: `Expense: ${expense.description}`,
          linkedEntityType: 'EXPENSE',
          linkedEntityId: expenseId,
          balanceAfter: updatedAccount.currentBalance,
          createdById: actorId,
        },
      });

      return tx.expense.findUnique({ where: { id: expenseId } });
    });
  }

  async update(societyId: string, expenseId: string, dto: Partial<CreateExpenseDto>) {
    const expense = await this.findOne(societyId, expenseId);
    if (expense.status !== ExpenseStatus.PENDING) {
      throw new ForbiddenException('Only pending expenses can be edited');
    }
    return this.prisma.expense.update({
      where: { id: expenseId },
      data: {
        ...(dto.description   !== undefined && { description:   dto.description }),
        ...(dto.amount        !== undefined && { amount:        new Prisma.Decimal(dto.amount) }),
        ...(dto.expenseDate   !== undefined && { expenseDate:   new Date(dto.expenseDate) }),
        ...(dto.categoryId    !== undefined && { categoryId:    dto.categoryId }),
        ...(dto.vendorPayee   !== undefined && { vendorPayee:   dto.vendorPayee }),
        ...(dto.notes         !== undefined && { notes:         dto.notes }),
        ...(dto.invoiceNumber !== undefined && { invoiceNumber: dto.invoiceNumber }),
      },
      include: {
        category: { select: { id: true, name: true } },
        account:  { select: { id: true, name: true } },
      },
    });
  }

  async remove(societyId: string, expenseId: string) {
    const expense = await this.findOne(societyId, expenseId);
    if (expense.status !== ExpenseStatus.PENDING) {
      throw new ForbiddenException('Only pending expenses can be deleted');
    }
    await this.prisma.expense.delete({ where: { id: expenseId } });
    return { success: true };
  }

  async getCategories(societyId: string) {
    return this.prisma.expenseCategory.findMany({
      where: { societyId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(societyId: string, name: string, description?: string) {
    return this.prisma.expenseCategory.create({
      data: { societyId, name, description },
    });
  }
}
