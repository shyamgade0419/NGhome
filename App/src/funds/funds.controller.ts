import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { FundsService, CreateFundDto } from './funds.service';
import { UpdateFundDto } from './dto/create-fund.dto';
import { ContributeFundDto } from './dto/contribute-fund.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Funds')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('funds')
export class FundsController {
  constructor(private readonly fundsService: FundsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Create a fund' })
  create(@SocietyId() societyId: string, @Body() dto: CreateFundDto) {
    return this.fundsService.create(societyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List funds (residents see only visible ones)' })
  findAll(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser) {
    const forResident = !user.isPlatformAdmin && user.currentRole === 'RESIDENT';
    return this.fundsService.findAll(societyId, forResident);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get fund by ID' })
  findOne(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.fundsService.findOne(societyId, id, user.currentRole === 'RESIDENT');
  }

  @Post(':id/contribute')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Add money to a fund (corpus contribution, transfer of surplus)' })
  contribute(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @Body() dto: ContributeFundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fundsService.contribute(societyId, id, dto, user.id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Update a fund' })
  update(@SocietyId() societyId: string, @Param('id') id: string, @Body() dto: UpdateFundDto) {
    return this.fundsService.update(societyId, id, dto);
  }
}
