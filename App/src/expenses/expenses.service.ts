import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction, DocumentAccessLevel, Prisma, ExpenseStatus, SystemRole, TransactionType } from '@prisma/client';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';
import { SftpStorageService } from '../documents/sftp-storage.service';
import { StoragePathService } from '../documents/storage-path.service';
import { DocumentsService } from '../documents/documents.service';
import { assertAllowedUpload } from '../documents/file-safety';
import {
  MAX_RECEIPTS_PER_EXPENSE, RECEIPT_SELECT, canAddReceipt, canRemoveReceipt, isReceiptType,
} from './expense-receipts';

import { CreateExpenseDto, UpdateExpenseDto } from './dto/create-expense.dto';
import {
  MAX_EXPENSE_AMOUNT, amountDelta, correctionLedgerText, correctionRefusal, planExpenseChanges,
} from './expense-corrections';
export { CreateExpenseDto } from './dto/create-expense.dto';

/** Only receipts that are still there — a removed one is kept as a row, hidden. */
const LIVE_RECEIPTS = { where: { isActive: true }, select: RECEIPT_SELECT, orderBy: { createdAt: 'asc' } } as const;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SftpStorageService,
    private readonly paths: StoragePathService,
    private readonly documents: DocumentsService,
  ) {}

  /**
   * Find-or-create a category by name, scoped to the society. Same pattern as
   * EventsService.recordExpense — categories are a lazily provisioned per-
   * society lookup, so a society never has to seed them before logging an
   * expense, and two expenses in the same category always land on one row
   * (@@unique([societyId, name])).
   */
  private async resolveCategoryId(
    societyId: string,
    dto: Pick<CreateExpenseDto, 'categoryId' | 'category'>,
  ): Promise<string | undefined> {
    if (dto.categoryId) {
      // A normal foreign key only guarantees the category row exists
      // somewhere — never trust a client-supplied id to already belong to
      // this society. The name-based path just below is safe by
      // construction (societyId_name is scoped to the caller's own
      // society); this is the one place a raw id skips that.
      const category = await this.prisma.expenseCategory.findFirst({
        where: { id: dto.categoryId, societyId },
      });
      if (!category) throw new NotFoundException('Category not found in this society');
      return category.id;
    }

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

    if (dto.accountId) {
      const account = await this.prisma.account.findFirst({ where: { id: dto.accountId, societyId, isActive: true } });
      if (!account) throw new NotFoundException('Account not found in this society');
    }

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
          fund: { select: { id: true, name: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          documents: LIVE_RECEIPTS,
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
        fund: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        documents: LIVE_RECEIPTS,
      },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  /**
   * Attach a receipt (a photo from the camera, or a PDF) to an expense. The file goes to storage
   * first — network I/O cannot sit inside a transaction — and is taken back out if anything after
   * it fails, so a refused upload never leaves a file nothing points at.
   *
   * The expense row is touched at the start of the transaction, which holds its lock until commit:
   * two phones adding receipts to the same expense are counted one after the other, so the cap
   * cannot be passed by a race.
   */
  async addReceipt(
    societyId: string,
    expenseId: string,
    actorId: string,
    file: { originalname: string; size: number; mimetype: string; buffer: Buffer },
  ) {
    assertAllowedUpload(file);
    if (!isReceiptType(file.mimetype)) {
      throw new BadRequestException('A receipt must be a photo (JPG, PNG, WebP, HEIC) or a PDF.');
    }

    const expense = await this.findOne(societyId, expenseId);
    if (!canAddReceipt(expense.status)) {
      throw new ForbiddenException('A rejected expense cannot take new receipts.');
    }

    const remotePath = await this.paths.societyFile(societyId, 'expenses', this.paths.storedFileName(file.originalname));
    await this.storage.upload(file.buffer, remotePath);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const touched = await tx.expense.updateMany({
          where: { id: expenseId, societyId, status: { not: ExpenseStatus.REJECTED } },
          data: { updatedAt: new Date() },
        });
        if (touched.count === 0) throw new ForbiddenException('A rejected expense cannot take new receipts.');

        const have = await tx.document.count({ where: { isActive: true, expenses: { some: { id: expenseId } } } });
        if (have >= MAX_RECEIPTS_PER_EXPENSE) {
          throw new BadRequestException(`An expense can have at most ${MAX_RECEIPTS_PER_EXPENSE} receipts.`);
        }

        const doc = await tx.document.create({
          data: {
            societyId,
            uploadedById: actorId,
            title: `Expense receipt — ${expense.description}`.slice(0, 200),
            fileName: file.originalname,
            fileKey: remotePath,
            fileSize: file.size,
            mimeType: file.mimetype,
            storageProvider: 'sftp',
            // Evidence for one expense, not a society document: kept out of the Documents list, and
            // read back only through the expense (getReceiptFile), which checks the link.
            accessLevel: DocumentAccessLevel.ADMIN_ONLY,
            category: 'expenses',
            linkedEntityType: 'EXPENSE',
            linkedEntityId: expenseId,
            expenses: { connect: { id: expenseId } },
          },
          select: RECEIPT_SELECT,
        });

        await tx.auditLog.create({
          data: {
            societyId,
            actorId,
            // A receipt is a change to the expense, so it reads as one in the trail; the detail says which.
            action: 'EXPENSE_MODIFIED',
            entityType: 'Expense',
            entityId: expenseId,
            newValues: { receiptAdded: { documentId: doc.id, fileName: file.originalname } } as Prisma.InputJsonValue,
          },
        });
        return doc;
      });
    } catch (err) {
      // Nothing committed, so no row will ever point at the file. remove() never throws.
      await this.storage.remove(remotePath);
      throw err;
    }
  }

  /** The stored receipt, if it belongs to this expense in this society and has not been removed. */
  private async findReceipt(societyId: string, expenseId: string, documentId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, societyId, isActive: true, expenses: { some: { id: expenseId, societyId } } },
    });
    if (!doc) throw new NotFoundException('Receipt not found');
    return doc;
  }

  async getReceiptFile(societyId: string, expenseId: string, documentId: string) {
    const doc = await this.findReceipt(societyId, expenseId, documentId);
    if (doc.storageProvider !== 'sftp' || !(await this.paths.isSocietyKey(societyId, doc.fileKey))) {
      throw new NotFoundException('Receipt not found');
    }
    const buffer = await this.storage.download(doc.fileKey);
    return { buffer, fileName: doc.fileName, mimeType: doc.mimeType };
  }

  async removeReceipt(societyId: string, expenseId: string, documentId: string, actorId: string) {
    const expense = await this.findOne(societyId, expenseId);
    if (!canRemoveReceipt(expense.status)) {
      throw new ForbiddenException('A paid expense keeps its receipts — they are part of the record.');
    }
    await this.findReceipt(societyId, expenseId, documentId);
    // The same soft-delete every document gets: file taken off storage, row hidden, audit written.
    await this.documents.softDelete(societyId, documentId, actorId, true);
    return { success: true };
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

  /**
   * Pays an approved expense out of an account — and, when `fundId` is given, out of that fund too. A
   * fund is money earmarked inside the bank accounts, so paying from it must lower both together;
   * otherwise the funds would add up to more than the bank holds.
   */
  async markPaid(societyId: string, expenseId: string, accountId: string, actorId: string, fundId?: string) {
    // Fetch for scope verification; the status gate and the amount are taken again inside the transaction
    const expense = await this.findOne(societyId, expenseId);
    if (fundId && expense.linkedEntityType === 'EVENT') {
      throw new BadRequestException("This expense came from an event and has already been taken from the event's fund.");
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Atomic status check-and-update
      const { count } = await tx.expense.updateMany({
        where: { id: expenseId, societyId, status: ExpenseStatus.APPROVED },
        data: { status: ExpenseStatus.PAID, paidAt: new Date(), accountId },
      });
      if (count === 0) {
        throw new ForbiddenException('Only approved expenses can be marked as paid');
      }
      // The row is now locked to this transaction, so this is the amount as it stands: an admin correcting
      // the expense a moment ago cannot leave us debiting the old figure.
      const { amount } = await tx.expense.findUniqueOrThrow({ where: { id: expenseId }, select: { amount: true } });

      // 2. Verify account belongs to society
      const account = await tx.account.findFirst({ where: { id: accountId, societyId, isActive: true } });
      if (!account) throw new NotFoundException('Account not found');

      // 3. Take it out of the fund, if one is named, never below zero
      if (fundId) {
        const fund = await tx.fund.findFirst({ where: { id: fundId, societyId, isActive: true } });
        if (!fund) throw new NotFoundException('Fund not found');
        const taken = await tx.fund.updateMany({
          where: { id: fundId, currentBalance: { gte: amount } },
          data: { currentBalance: { decrement: amount } },
        });
        if (taken.count === 0) {
          throw new BadRequestException(`${fund.name} holds only ₹${fund.currentBalance.toFixed(2)}, which is less than this expense.`);
        }
        await tx.expense.update({ where: { id: expenseId }, data: { fundId } });
      }

      // 4. Atomic balance decrement — avoids read-modify-write race
      const updatedAccount = await tx.account.update({
        where: { id: accountId },
        data: { currentBalance: { decrement: amount } },
      });

      await tx.transaction.create({
        data: {
          societyId,
          accountId,
          fundId: fundId ?? null,
          transactionType: 'DEBIT',
          amount,
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

  /**
   * Edits an expense. While it is PENDING anyone who can see expenses may fix it. Once it is APPROVED or
   * PAID it is part of the books, so only the admin may change it, and only with a comment: the old and new
   * values, who changed them and why go to the audit log, and the latest comment is shown on the expense.
   *
   * Changing the amount of a PAID expense moves the account it was paid from (and the fund, if it came out
   * of one) by the difference, with a correcting entry on the account's ledger, so the bank balance never
   * disagrees with the expenses. Dates and wording change nothing but the expense.
   */
  async update(societyId: string, expenseId: string, dto: UpdateExpenseDto, actor: { id: string; role?: string }) {
    const current = await this.findOne(societyId, expenseId);

    let wantedAmount: Prisma.Decimal | undefined;
    if (dto.amount !== undefined) {
      wantedAmount = new Prisma.Decimal(dto.amount);
      if (wantedAmount.decimalPlaces() > 2) throw new BadRequestException('An amount can have at most two decimal places.');
      if (wantedAmount.gt(MAX_EXPENSE_AMOUNT)) throw new BadRequestException('That amount is too large.');
    }
    let wantedDate: Date | undefined;
    if (dto.expenseDate !== undefined) {
      wantedDate = new Date(dto.expenseDate);
      if (Number.isNaN(wantedDate.getTime())) throw new BadRequestException('That is not a valid date.');
    }

    const categoryWanted = dto.categoryId !== undefined || !!dto.category?.trim();
    const categoryId = categoryWanted ? ((await this.resolveCategoryId(societyId, dto)) ?? null) : undefined;

    // The account a paid expense came out of is not editable: moving it would mean moving money between
    // accounts, which is its own entry. Before it is paid there is nothing to move, so it may still be set.
    const accountWanted = dto.accountId !== undefined && dto.accountId !== current.accountId;
    if (accountWanted) {
      if (current.status === ExpenseStatus.PAID) {
        throw new BadRequestException('The account this was paid from cannot be changed. Correct the amount or date instead.');
      }
      if (dto.accountId) {
        const account = await this.prisma.account.findFirst({ where: { id: dto.accountId, societyId, isActive: true } });
        if (!account) throw new NotFoundException('Account not found in this society');
      }
    }

    const wanted = {
      amount: wantedAmount,
      expenseDate: wantedDate,
      description: dto.description,
      vendorPayee: dto.vendorPayee,
      invoiceNumber: dto.invoiceNumber,
      referenceNumber: dto.referenceNumber,
      notes: dto.notes,
      categoryId,
    };
    const reason = dto.reason?.trim() || undefined;
    const refusal = correctionRefusal({
      status: current.status,
      isAdmin: actor.role === SystemRole.SOCIETY_ADMIN,
      reason,
      amountChanges: planExpenseChanges(current, { amount: wantedAmount }).amount !== undefined,
      eventLinked: current.linkedEntityType === 'EVENT',
    });
    if (refusal) {
      throw refusal.kind === 'forbidden' ? new ForbiddenException(refusal.message) : new BadRequestException(refusal.message);
    }

    return this.prisma.$transaction(async (tx) => {
      // The row lock for everything below: a payment, another correction or a rejection that lands at the
      // same moment waits, then is judged against what is true after this one.
      const touched = await tx.expense.updateMany({
        where: { id: expenseId, societyId, status: { not: ExpenseStatus.REJECTED } },
        data: { updatedAt: new Date() },
      });
      if (touched.count === 0) throw new ForbiddenException('A rejected expense cannot be edited.');

      const fresh = await tx.expense.findUniqueOrThrow({ where: { id: expenseId } });
      const posted = fresh.status !== ExpenseStatus.PENDING;
      // Approved or paid while the form was open: the admin-and-comment rule now applies.
      const lateRefusal = correctionRefusal({
        status: fresh.status,
        isAdmin: actor.role === SystemRole.SOCIETY_ADMIN,
        reason,
        amountChanges: planExpenseChanges(fresh, { amount: wantedAmount }).amount !== undefined,
        eventLinked: fresh.linkedEntityType === 'EVENT',
      });
      if (lateRefusal) {
        throw lateRefusal.kind === 'forbidden' ? new ForbiddenException(lateRefusal.message) : new BadRequestException(lateRefusal.message);
      }

      const changes = planExpenseChanges(fresh, wanted);
      const accountChange = dto.accountId !== undefined && dto.accountId !== fresh.accountId && fresh.status !== ExpenseStatus.PAID;
      if (Object.keys(changes).length === 0 && !accountChange) {
        throw new BadRequestException('Nothing was changed.');
      }

      let accountBalanceAfter: string | null = null;
      let fundBalanceAfter: string | null = null;
      if (changes.amount && fresh.status === ExpenseStatus.PAID) {
        if (!fresh.accountId) {
          throw new BadRequestException('This paid expense has no account on record, so its amount cannot be corrected here.');
        }
        const delta = amountDelta(fresh.amount, wantedAmount!);
        const abs = delta.abs();
        const more = delta.gt(0);

        if (fresh.fundId) {
          const moved = await tx.fund.updateMany({
            where: more ? { id: fresh.fundId, currentBalance: { gte: abs } } : { id: fresh.fundId },
            data: { currentBalance: more ? { decrement: abs } : { increment: abs } },
          });
          if (moved.count === 0) {
            throw new BadRequestException('The fund this was paid from does not hold enough for the higher amount.');
          }
          const fund = await tx.fund.findUniqueOrThrow({ where: { id: fresh.fundId }, select: { currentBalance: true } });
          fundBalanceAfter = fund.currentBalance.toFixed(2);
        }

        const account = await tx.account.update({
          where: { id: fresh.accountId },
          data: { currentBalance: more ? { decrement: abs } : { increment: abs } },
        });
        accountBalanceAfter = account.currentBalance.toFixed(2);

        await tx.transaction.create({
          data: {
            societyId,
            accountId: fresh.accountId,
            fundId: fresh.fundId,
            transactionType: more ? TransactionType.DEBIT : TransactionType.CREDIT,
            amount: abs,
            transactionDate: new Date(),
            description: correctionLedgerText(fresh.description, changes.amount.from ?? '', changes.amount.to ?? '', reason ?? ''),
            linkedEntityType: 'EXPENSE',
            linkedEntityId: expenseId,
            balanceAfter: account.currentBalance,
            createdById: actor.id,
          },
        });
      }

      const updated = await tx.expense.update({
        where: { id: expenseId },
        data: {
          ...(wanted.amount !== undefined && { amount: wanted.amount }),
          ...(wanted.expenseDate !== undefined && { expenseDate: wanted.expenseDate }),
          ...(wanted.description !== undefined && { description: wanted.description }),
          ...(wanted.vendorPayee !== undefined && { vendorPayee: wanted.vendorPayee }),
          ...(wanted.invoiceNumber !== undefined && { invoiceNumber: wanted.invoiceNumber }),
          ...(wanted.referenceNumber !== undefined && { referenceNumber: wanted.referenceNumber }),
          ...(wanted.notes !== undefined && { notes: wanted.notes }),
          ...(wanted.categoryId !== undefined && { categoryId: wanted.categoryId }),
          ...(accountChange && { accountId: dto.accountId || null }),
          ...(posted && { correctedAt: new Date(), correctionNote: reason }),
        },
        include: {
          category: { select: { id: true, name: true } },
          account: { select: { id: true, name: true } },
          fund: { select: { id: true, name: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          societyId,
          actorId: actor.id,
          action: AuditAction.EXPENSE_MODIFIED,
          entityType: 'Expense',
          entityId: expenseId,
          newValues: {
            status: fresh.status,
            reason: reason ?? null,
            changes,
            accountBalanceAfter,
            fundBalanceAfter,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  }

  /** Every correction made to an expense, newest first: what changed, who changed it and the comment they gave. */
  async history(societyId: string, expenseId: string) {
    await this.findOne(societyId, expenseId);
    const rows = await this.prisma.auditLog.findMany({
      where: { societyId, entityType: 'Expense', entityId: expenseId, action: AuditAction.EXPENSE_MODIFIED },
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { id: true, firstName: true, lastName: true } } },
    });
    return rows
      .filter((r) => r.newValues && typeof r.newValues === 'object' && 'changes' in (r.newValues as object))
      .map((r) => {
        const v = r.newValues as { reason?: string | null; changes?: unknown; accountBalanceAfter?: string | null };
        return {
          id: r.id,
          at: r.createdAt,
          by: r.actor ? `${r.actor.firstName} ${r.actor.lastName}`.trim() : null,
          reason: v.reason ?? null,
          changes: v.changes ?? {},
          accountBalanceAfter: v.accountBalanceAfter ?? null,
        };
      });
  }

  async remove(societyId: string, expenseId: string, actorId: string) {
    const expense = await this.findOne(societyId, expenseId);
    if (expense.status !== ExpenseStatus.PENDING) {
      throw new ForbiddenException('Only pending expenses can be deleted');
    }
    // Deleting the expense drops the link, not the files — take those off storage too.
    const receipts = await this.prisma.document.findMany({
      where: { isActive: true, expenses: { some: { id: expenseId } } },
      select: { id: true },
    });
    await this.prisma.expense.delete({ where: { id: expenseId } });
    for (const r of receipts) {
      await this.documents.softDelete(societyId, r.id, actorId, true).catch(() => undefined);
    }
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
