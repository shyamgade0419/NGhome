import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';

@ApiTags('Transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'List all financial transactions for the society' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'accountId', required: false })
  @ApiQuery({ name: 'fundId', required: false })
  @ApiQuery({ name: 'fromDate', required: false })
  @ApiQuery({ name: 'toDate', required: false })
  async findAll(
    @SocietyId() societyId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('accountId') accountId?: string,
    @Query('fundId') fundId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const { skip, take } = getPaginationParams({ page: +page, limit: +limit });
    const where = {
      societyId,
      ...(accountId ? { accountId } : {}),
      ...(fundId ? { fundId } : {}),
      ...(fromDate || toDate
        ? {
            transactionDate: {
              ...(fromDate ? { gte: new Date(fromDate) } : {}),
              ...(toDate ? { lte: new Date(toDate) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        skip,
        take,
        where,
        include: { account: { select: { id: true, name: true } } },
        orderBy: { transactionDate: 'desc' },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, +page, +limit) };
  }
}
