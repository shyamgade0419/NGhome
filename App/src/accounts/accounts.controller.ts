import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { AccountsService, CreateAccountDto } from './accounts.service';
import { UpdateAccountDto } from './dto/create-account.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';

@ApiTags('Accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Create a bank/cash account' })
  create(@SocietyId() societyId: string, @Body() dto: CreateAccountDto) {
    return this.accountsService.create(societyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all accounts' })
  findAll(@SocietyId() societyId: string) {
    return this.accountsService.findAll(societyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get account by ID' })
  findOne(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.accountsService.findOne(societyId, id);
  }

  @Patch(':id')
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Update account details' })
  update(@SocietyId() societyId: string, @Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accountsService.update(societyId, id, dto);
  }

  @Get(':id/transactions')
  @ApiOperation({ summary: 'Get account transaction history' })
  getTransactions(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.accountsService.getTransactions(societyId, id, +page, +limit);
  }
}
