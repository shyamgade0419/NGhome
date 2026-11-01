import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { AccountsService, CreateAccountDto } from './accounts.service';
import { UpdateAccountDto } from './dto/create-account.dto';
import { AdjustAccountDto } from './dto/adjust-account.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

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

  @Post(':id/adjust')
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Raise or lower an account balance by hand to match the bank, with a comment' })
  adjust(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @Body() dto: AdjustAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsService.adjust(societyId, id, dto, user.id);
  }

  @Delete(':id')
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Delete an account made by mistake (or hide it, if it has already been used)' })
  remove(@SocietyId() societyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.remove(societyId, id, user.id);
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
