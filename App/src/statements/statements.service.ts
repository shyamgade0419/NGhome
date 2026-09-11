import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class StatementsService {
  constructor(private readonly prisma: PrismaService) {}

  // publishedById is accepted for symmetry with publish() below and because
  // the controller already has the actor's id here, but MonthlyStatement has
  // no field to record who generated it — kept, not persisted; not this
  // audit's call to add a schema field for it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async generateStatement(societyId: string, periodId: string, publishedById: string) {
    const period = await this.prisma.billingPeriod.findFirst({
      where: { id: periodId, societyId },
    });
    if (!period) throw new NotFoundException('Billing period not found');

    // Aggregate financial data for the period
    const [totalExpenses, totalSalaries] = await Promise.all([
      this.prisma.expense.aggregate({
        where: { societyId, status: 'PAID', expenseDate: { gte: period.startDate, lte: period.endDate } },
        _sum: { amount: true },
      }),
      this.prisma.salaryRecord.aggregate({
        where: {
          societyId,
          status: 'PAID',
          salaryMonth: period.periodMonth,
          salaryYear: period.periodYear,
        },
        _sum: { netSalary: true },
      }),
    ]);

    const expenseSum = totalExpenses._sum.amount?.toNumber() ?? 0;
    const salarySum = totalSalaries._sum.netSalary?.toNumber() ?? 0;

    return this.prisma.monthlyStatement.upsert({
      where: { billingPeriodId: periodId },
      create: {
        societyId,
        billingPeriodId: periodId,
        title: `Statement ${period.periodMonth}/${period.periodYear}`,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        totalMaintenance: period.totalBilled,
        totalCollected: period.totalCollected,
        totalPending: period.totalPending,
        totalExpenses: new Prisma.Decimal(expenseSum),
        totalSalaries: new Prisma.Decimal(salarySum),
        content: {} as Prisma.InputJsonValue,
      },
      update: {
        totalMaintenance: period.totalBilled,
        totalCollected: period.totalCollected,
        totalPending: period.totalPending,
        totalExpenses: new Prisma.Decimal(expenseSum),
        totalSalaries: new Prisma.Decimal(salarySum),
      },
    });
  }

  async publish(societyId: string, statementId: string, publishedById: string) {
    const stmt = await this.prisma.monthlyStatement.findFirst({
      where: { id: statementId, societyId },
    });
    if (!stmt) throw new NotFoundException('Statement not found');

    return this.prisma.monthlyStatement.update({
      where: { id: statementId },
      data: { isPublished: true, publishedAt: new Date(), publishedById },
    });
  }

  async findAll(societyId: string, forResident = false) {
    return this.prisma.monthlyStatement.findMany({
      where: {
        societyId,
        ...(forResident ? { isPublished: true } : {}),
      },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    });
  }

  async findOne(societyId: string, id: string, forResident = false) {
    const where: Prisma.MonthlyStatementWhereInput = { id, societyId };
    if (forResident) where.isPublished = true;

    const stmt = await this.prisma.monthlyStatement.findFirst({ where });
    if (!stmt) throw new NotFoundException('Statement not found');
    return stmt;
  }
}
