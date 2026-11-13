import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, SalaryStatus } from '@prisma/client';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { ProcessSalaryDto } from './dto/process-salary.dto';
import { ExpenseLock, isMonthLocked, loadExpenseLock, lockMessage } from '../common/books-lock';

@Injectable()
export class SalariesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Refuses a salary for a closed month, or any month before one. Pay for those months is part of the books that were closed,
   * so it is not processed, changed or paid afterwards. (An employee's own details, such as their base salary, are not
   * month-bound and stay editable: they only matter from the next month on.)
   */
  private async assertMonthOpen(societyId: string, year: number, month: number): Promise<void> {
    const lock = await loadExpenseLock(this.prisma, societyId);
    if (isMonthLocked(year, month, lock)) throw new ForbiddenException(lockMessage(lock, 'salary'));
  }

  /** How far the books are closed, for the screen to show. */
  async lockedThrough(societyId: string): Promise<{ lockedThrough: ExpenseLock['through'] }> {
    return { lockedThrough: (await loadExpenseLock(this.prisma, societyId)).through };
  }

  async createEmployee(societyId: string, dto: CreateEmployeeDto) {
    return this.prisma.societyEmployee.create({
      data: {
        societyId,
        name: dto.name,
        designation: dto.designation,
        employeeCode: dto.employeeCode,
        phone: dto.phone,
        email: dto.email,
        joinDate: dto.joinDate ? new Date(dto.joinDate) : undefined,
        baseSalary: new Prisma.Decimal(dto.baseSalary),
      },
    });
  }

  async findEmployees(societyId: string) {
    return this.prisma.societyEmployee.findMany({
      where: { societyId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async processSalary(societyId: string, dto: ProcessSalaryDto) {
    await this.assertMonthOpen(societyId, dto.salaryYear, dto.salaryMonth);
    const employee = await this.prisma.societyEmployee.findFirst({
      where: { id: dto.employeeId, societyId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    if (dto.accountId) {
      const account = await this.prisma.account.findFirst({ where: { id: dto.accountId, societyId, isActive: true } });
      if (!account) throw new NotFoundException('Account not found in this society');
    }

    const existing = await this.prisma.salaryRecord.findFirst({
      where: {
        societyId,
        employeeId: dto.employeeId,
        salaryMonth: dto.salaryMonth,
        salaryYear: dto.salaryYear,
      },
    });
    if (existing && existing.status !== SalaryStatus.DRAFT) {
      throw new BadRequestException('Salary already processed for this month');
    }

    const base = dto.baseSalary ?? employee.baseSalary.toNumber();
    const additions = dto.additions ?? 0;
    const deductions = dto.deductions ?? 0;
    const net = base + additions - deductions;

    if (existing) {
      return this.prisma.salaryRecord.update({
        where: { id: existing.id },
        data: {
          baseSalary: new Prisma.Decimal(base),
          additions: new Prisma.Decimal(additions),
          deductions: new Prisma.Decimal(deductions),
          netSalary: new Prisma.Decimal(net),
          accountId: dto.accountId,
          notes: dto.notes,
          additionsDetail: dto.additionsDetail as Prisma.InputJsonValue,
          deductionsDetail: dto.deductionsDetail as Prisma.InputJsonValue,
        },
      });
    }

    return this.prisma.salaryRecord.create({
      data: {
        societyId,
        employeeId: dto.employeeId,
        salaryMonth: dto.salaryMonth,
        salaryYear: dto.salaryYear,
        baseSalary: new Prisma.Decimal(base),
        additions: new Prisma.Decimal(additions),
        deductions: new Prisma.Decimal(deductions),
        netSalary: new Prisma.Decimal(net),
        accountId: dto.accountId,
        notes: dto.notes,
        additionsDetail: dto.additionsDetail as Prisma.InputJsonValue,
        deductionsDetail: dto.deductionsDetail as Prisma.InputJsonValue,
      },
    });
  }

  async paySalary(societyId: string, salaryRecordId: string, actorId: string) {
    const record = await this.prisma.salaryRecord.findFirst({
      where: { id: salaryRecordId, societyId },
    });
    if (!record) throw new NotFoundException('Salary record not found');
    // Idempotent: a retry of a payment that already succeeded (the response
    // to the first attempt was lost, or two requests both got this far)
    // returns the same authoritative result rather than erroring.
    if (record.status === SalaryStatus.PAID) return record;
    if (record.status !== SalaryStatus.PROCESSED && record.status !== SalaryStatus.DRAFT) {
      throw new BadRequestException('Salary must be in DRAFT or PROCESSED state');
    }
    await this.assertMonthOpen(societyId, record.salaryYear, record.salaryMonth);
    if (!record.accountId) throw new BadRequestException('Account not set for salary payment');

    return this.prisma.$transaction(async (tx) => {
      /**
       * Atomic claim, checked before any money moves. Two concurrent
       * paySalary() calls for the same record both pass the check above —
       * neither has written anything yet at that point. Without this, both
       * would go on to decrement the account and write a ledger row: one
       * salary, two debits, two Transaction rows. Postgres serializes two
       * concurrent UPDATEs against the same row (the second blocks until
       * the first's transaction commits, then re-evaluates its WHERE
       * clause against the now-PAID row), so at most one of these ever
       * reports count === 1 — same pattern as refresh-token rotation.
       *
       * This is also the crash-safety story: the status flip lives in the
       * same transaction as the account debit and the ledger write. If
       * anything after this point fails, Postgres rolls back the whole
       * transaction — status flip included — so the record lands back on
       * DRAFT/PROCESSED, safe to retry. There is no intermediate state a
       * salary can get stuck in.
       */
      const claimed = await tx.salaryRecord.updateMany({
        where: {
          id: salaryRecordId,
          societyId,
          status: { in: [SalaryStatus.DRAFT, SalaryStatus.PROCESSED] },
        },
        data: { status: SalaryStatus.PAID, paymentDate: new Date(), processedAt: new Date() },
      });
      if (claimed.count !== 1) {
        const current = await tx.salaryRecord.findUnique({ where: { id: salaryRecordId } });
        if (current?.status === SalaryStatus.PAID) return current; // the race's other side already paid it
        throw new BadRequestException('Salary must be in DRAFT or PROCESSED state');
      }

      const account = await tx.account.findFirst({ where: { id: record.accountId!, societyId, isActive: true } });
      if (!account) throw new NotFoundException('Account not found');

      /**
       * Atomic decrement, not a computed absolute. This previously read
       * currentBalance, subtracted in JavaScript, and wrote the result back —
       * so two salaries paid at the same moment both started from the same
       * figure and the second write erased the first, losing a debit
       * entirely. Being inside a transaction does not prevent that at
       * Postgres's default isolation; only the atomic operation does.
       *
       * It also keeps the arithmetic in Decimal. The old path went through
       * .toNumber() on both sides, which is float maths on money in a
       * codebase that uses Decimal everywhere else precisely to avoid it.
       */
      const updatedAccount = await tx.account.update({
        where: { id: record.accountId! },
        data: { currentBalance: { decrement: record.netSalary } },
      });

      await tx.transaction.create({
        data: {
          societyId,
          accountId: record.accountId!,
          transactionType: 'DEBIT',
          amount: record.netSalary,
          transactionDate: new Date(),
          description: `Salary: Employee ${record.employeeId} (${record.salaryMonth}/${record.salaryYear})`,
          linkedEntityType: 'SALARY',
          linkedEntityId: salaryRecordId,
          // The post-decrement balance, so the ledger line matches what the
          // account actually holds after this payment.
          balanceAfter: updatedAccount.currentBalance,
          createdById: actorId,
        },
      });

      return tx.salaryRecord.findUnique({ where: { id: salaryRecordId } });
    });
  }

  async findSalaryRecords(societyId: string, month?: number, year?: number) {
    const [records, lock] = await Promise.all([this.findSalaryRecordRows(societyId, month, year), loadExpenseLock(this.prisma, societyId)]);
    // Each record says whether its month is closed, so the screen can show the lock and offer nothing on it.
    return records.map((r) => ({ ...r, locked: isMonthLocked(r.salaryYear, r.salaryMonth, lock) }));
  }

  private findSalaryRecordRows(societyId: string, month?: number, year?: number) {
    return this.prisma.salaryRecord.findMany({
      where: {
        societyId,
        ...(month ? { salaryMonth: month } : {}),
        ...(year ? { salaryYear: year } : {}),
      },
      include: {
        employee: { select: { id: true, name: true, designation: true } },
      },
      orderBy: [{ salaryYear: 'desc' }, { salaryMonth: 'desc' }],
    });
  }
}
