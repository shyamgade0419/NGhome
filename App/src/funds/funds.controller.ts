import { Controller, Get, Post, Patch, Body, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { ResidencyService } from '../common/residency.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { FundsService, CreateFundDto } from './funds.service';
import { UpdateFundDto } from './dto/create-fund.dto';
import { ContributeFundDto } from './dto/contribute-fund.dto';
import { AdjustFundDto } from './dto/adjust-fund.dto';
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
  constructor(
    private readonly fundsService: FundsService,
    private readonly residency: ResidencyService,
  ) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Create a fund' })
  create(@SocietyId() societyId: string, @Body() dto: CreateFundDto) {
    return this.fundsService.create(societyId, dto);
  }

  @Get('summary')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Bank total, corpus, other funds and the rest, with a check that they add up' })
  summary(@SocietyId() societyId: string) {
    return this.fundsService.summary(societyId);
  }

  @Get()
  @ApiOperation({ summary: 'List funds (residents see only visible ones)' })
  async findAll(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser) {
    // The corpus and the other funds are the owners' business: a tenant is sent none, whatever each fund's
    // "visible to residents" switch says.
    if (await this.residency.isTenantViewer(user)) return [];
    const forResident = !user.isPlatformAdmin && user.currentRole === 'RESIDENT';
    return this.fundsService.findAll(societyId, forResident);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get fund by ID' })
  async findOne(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    if (await this.residency.isTenantViewer(user)) throw new NotFoundException('Fund not found');
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

  @Post(':id/adjust')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Raise or lower a fund by hand, with a comment (lowering is admin only)' })
  adjust(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @Body() dto: AdjustFundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fundsService.adjust(societyId, id, dto, { id: user.id, role: user.currentRole });
  }

  @Get(':id/history')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Every entry that has moved a fund, with the comments' })
  history(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.fundsService.history(societyId, id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Update a fund' })
  update(@SocietyId() societyId: string, @Param('id') id: string, @Body() dto: UpdateFundDto) {
    return this.fundsService.update(societyId, id, dto);
  }
}
