import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SystemRole, ExpenseStatus } from '@prisma/client';
import { ExpensesService, CreateExpenseDto } from './expenses.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Expenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @ApiOperation({ summary: 'Record an expense' })
  create(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.expensesService.create(societyId, user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all expenses' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ExpenseStatus })
  findAll(
    @SocietyId() societyId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: ExpenseStatus,
  ) {
    return this.expensesService.findAll(societyId, +page, +limit, status);
  }

  @Get('categories')
  @ApiOperation({ summary: 'List expense categories' })
  getCategories(@SocietyId() societyId: string) {
    return this.expensesService.getCategories(societyId);
  }

  @Post('categories')
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Create expense category' })
  createCategory(
    @SocietyId() societyId: string,
    @Body() body: { name: string; description?: string },
  ) {
    return this.expensesService.createCategory(societyId, body.name, body.description);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get expense by ID' })
  findOne(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.expensesService.findOne(societyId, id);
  }

  @Post(':id/approve')
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Approve an expense' })
  approve(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expensesService.approve(societyId, id, user.id);
  }

  @Post(':id/mark-paid')
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Mark expense as paid from an account' })
  markPaid(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { accountId: string },
  ) {
    return this.expensesService.markPaid(societyId, id, body.accountId, user.id);
  }
}
