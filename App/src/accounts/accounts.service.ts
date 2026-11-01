import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction, Prisma } from '@prisma/client';
import { buildPaginationMeta } from '../common/utils/pagination';

import { CreateAccountDto } from './dto/create-account.dto';
export { CreateAccountDto } from './dto/create-account.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(societyId: string, dto: CreateAccountDto) {
    return this.prisma.account.create({
      data: {
        societyId,
        name: dto.name,
        accountType: dto.accountType,
        bankName: dto.bankName,
        accountNumberMasked: dto.accountNumberMasked,
        ifscCode: dto.ifscCode,
        openingBalance: dto.openingBalance
          ? new Prisma.Decimal(dto.openingBalance)
          : new Prisma.Decimal(0),
        currentBalance: dto.openingBalance
          ? new Prisma.Decimal(dto.openingBalance)
          : new Prisma.Decimal(0),
        description: dto.description,
      },
    });
  }

  async findAll(societyId: string) {
    return this.prisma.account.findMany({
      where: { societyId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(societyId: string, id: string) {
    const account = await this.prisma.account.findFirst({
      where: { id, societyId },
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async update(societyId: string, id: string, dto: Partial<CreateAccountDto>) {
    await this.findOne(societyId, id);
    return this.prisma.account.update({
      where: { id },
      data: {
        name: dto.name,
        bankName: dto.bankName,
        description: dto.description,
        isActive: true,
      },
    });
  }

  /**
   * Deletes an account entered by mistake.
   *
   * An account nobody has used yet (no ledger entries, no expense or salary paid from it) is removed outright.
   * One that has been used cannot be erased without breaking those records, so it is taken off every list and
   * out of every total instead, and its history stays on file. Either way it can no longer take new money, and
   * the admin can create it again with the right figures.
   */
  async remove(societyId: string, id: string, actorId: string) {
    const account = await this.findOne(societyId, id);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const transactions = await tx.transaction.count({ where: { accountId: id } });
        const expenses = await tx.expense.count({ where: { accountId: id } });
        const salaries = await tx.salaryRecord.count({ where: { accountId: id } });
        const used = transactions + expenses + salaries > 0;

        if (used) {
          await tx.account.update({ where: { id }, data: { isActive: false } });
        } else {
          // A fund that pointed at this account keeps its money; it just no longer names a bank account.
          await tx.fund.updateMany({ where: { accountId: id }, data: { accountId: null } });
          await tx.account.delete({ where: { id } });
        }

        await tx.auditLog.create({
          data: {
            societyId,
            actorId,
            action: AuditAction.CONFIG_CHANGED,
            entityType: 'Account',
            entityId: id,
            oldValues: {
              name: account.name,
              accountType: account.accountType,
              openingBalance: account.openingBalance.toString(),
              currentBalance: account.currentBalance.toString(),
            },
            newValues: { outcome: used ? 'REMOVED_FROM_LISTS' : 'DELETED', transactions, expenses, salaries },
          },
        });

        return { id, name: account.name, deleted: !used, removedFromLists: used, transactions, expenses, salaries };
      });
    } catch (e) {
      // Something started using the account between the check and the delete.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ConflictException('This account was just used by another change. Refresh and try again.');
      }
      throw e;
    }
  }

  async getTransactions(societyId: string, accountId: string, page: number, limit: number) {
    await this.findOne(societyId, accountId);
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        skip,
        take: limit,
        where: { societyId, accountId },
        orderBy: { transactionDate: 'desc' },
      }),
      this.prisma.transaction.count({ where: { societyId, accountId } }),
    ]);
    // Must be {data, meta}: TransformInterceptor only auto-unwraps a
    // pagination result shaped this way. The old {data, total, page, limit}
    // shape had no `meta` key, so the interceptor treated the whole object
    // as opaque payload and wrapped it a second time — every client's
    // PaginatedResponse.data ended up holding this object instead of the
    // transaction array, rendering as an empty ledger no matter how many
    // transactions actually existed.
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }
}
