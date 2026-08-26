import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, SalaryStatus } from '@prisma/client';

export interface CreateEmployeeDto {
  name: string;
  designation: string;
  employeeCode?: string;
  phone?: string;
  email?: string;
  joinDate?: string;
  baseSalary: number;
}

export interface ProcessSalaryDto {
  employeeId: string;
  salaryMonth: number;
  salaryYear: number;
  baseSalary?: number;
  additions?: number;
  deductions?: number;
  accountId?: string;
  notes?: string;
  additionsDetail?: Record<string, number>;
  deductionsDetail?: Record<string, number>;
}

@Injectable()
export class SalariesService {
  constructor(private readonly prisma: PrismaService) {}

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
    const employee = await this.prisma.societyEmployee.findFirst({
      where: { id: dto.employeeId, societyId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

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
    if (record.status !== SalaryStatus.PROCESSED && record.status !== SalaryStatus.DRAFT) {
      throw new BadRequestException('Salary must be in DRAFT or PROCESSED state');
    }
    if (!record.accountId) throw new BadRequestException('Account not set for salary payment');

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.account.findFirst({ where: { id: record.accountId!, societyId } });
      if (!account) throw new NotFoundException('Account not found');

      const newBalance = account.currentBalance.toNumber() - record.netSalary.toNumber();

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
          balanceAfter: new Prisma.Decimal(newBalance),
          createdById: actorId,
        },
      });

      await tx.account.update({
        where: { id: record.accountId! },
        data: { currentBalance: new Prisma.Decimal(newBalance) },
      });

      return tx.salaryRecord.update({
        where: { id: salaryRecordId },
        data: {
          status: SalaryStatus.PAID,
          paymentDate: new Date(),
          processedAt: new Date(),
        },
      });
    });
  }

  async findSalaryRecords(societyId: string, month?: number, year?: number) {
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
