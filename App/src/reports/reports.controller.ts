import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
@Controller('reports')
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('outstanding-dues')
  @ApiOperation({ summary: 'Get outstanding dues summary across all flats' })
  async outstandingDues(@SocietyId() societyId: string) {
    const bills = await this.prisma.maintenanceBill.findMany({
      where: { societyId, isPublished: true, isPaid: false },
      include: { flat: { select: { flatCode: true } } },
      orderBy: { dueDate: 'asc' },
    });

    const total = bills.reduce((sum, b) => sum + b.pendingAmount.toNumber(), 0);
    return { bills, totalOutstanding: total };
  }

  @Get('collection-summary')
  @ApiOperation({ summary: 'Monthly collection summary' })
  async collectionSummary(
    @SocietyId() societyId: string,
    @Query('year') year: number,
    @Query('month') month: number,
  ) {
    const period = await this.prisma.billingPeriod.findFirst({
      where: { societyId, periodYear: +year, periodMonth: +month },
    });
    if (!period) return { error: 'Period not found' };

    // Explicitly serialize Prisma Decimal fields — they don't have toJSON() and would
    // otherwise be emitted as raw decimal.js objects ({s,e,d}) which parseFloat() reads as NaN.
    return {
      period: {
        ...period,
        totalBilled: period.totalBilled.toString(),
        totalCollected: period.totalCollected.toString(),
        totalPending: period.totalPending.toString(),
      },
      totalBilled: period.totalBilled.toString(),
      totalCollected: period.totalCollected.toString(),
      totalPending: period.totalPending.toString(),
      collectionRate:
        period.totalBilled.toNumber() > 0
          ? ((period.totalCollected.toNumber() / period.totalBilled.toNumber()) * 100).toFixed(2) + '%'
          : '0%',
    };
  }

  @Get('expense-summary')
  @ApiOperation({ summary: 'Expense summary by category for a period' })
  async expenseSummary(
    @SocietyId() societyId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    const expenses = await this.prisma.expense.findMany({
      where: {
        societyId,
        status: { in: ['APPROVED', 'PAID'] },
        expenseDate: {
          gte: fromDate ? new Date(fromDate) : undefined,
          lte: toDate ? new Date(toDate) : undefined,
        },
      },
      include: { category: { select: { name: true } } },
    });

    const byCategory: Record<string, number> = {};
    let total = 0;

    for (const expense of expenses) {
      const cat = expense.category?.name ?? 'Uncategorized';
      byCategory[cat] = (byCategory[cat] ?? 0) + expense.amount.toNumber();
      total += expense.amount.toNumber();
    }

    return { byCategory, total, count: expenses.length };
  }

  @Get('account-balances')
  @ApiOperation({ summary: 'Current balances of all accounts' })
  async accountBalances(@SocietyId() societyId: string) {
    return this.prisma.account.findMany({
      where: { societyId, isActive: true },
      select: {
        id: true,
        name: true,
        accountType: true,
        currentBalance: true,
        bankName: true,
      },
      orderBy: { name: 'asc' },
    });
  }
}
