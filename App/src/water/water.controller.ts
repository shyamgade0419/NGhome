import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import {
  WaterService,
  CreateWaterConfigDto,
  RecordReadingDto,
  AllocateWaterCostsDto,
} from './water.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';

@ApiTags('Water Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('water')
export class WaterController {
  constructor(private readonly waterService: WaterService) {}

  @Post('configs')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Create water billing configuration' })
  createConfig(@SocietyId() societyId: string, @Body() dto: CreateWaterConfigDto) {
    return this.waterService.createConfig(societyId, dto);
  }

  @Get('configs')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'List water billing configurations' })
  findConfigs(@SocietyId() societyId: string) {
    return this.waterService.findConfigs(societyId);
  }

  @Post('readings')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT, SystemRole.SOCIETY_STAFF)
  @ApiOperation({ summary: 'Record water meter reading for a single flat' })
  recordReading(@SocietyId() societyId: string, @Body() dto: RecordReadingDto) {
    return this.waterService.recordReading(societyId, dto);
  }

  @Get('readings')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Get water meter readings' })
  findReadings(
    @SocietyId() societyId: string,
    @Query('periodId') periodId?: string,
    @Query('flatId') flatId?: string,
  ) {
    return this.waterService.findReadings(societyId, periodId, flatId);
  }

  /**
   * Society Allocation: batch-enter all flat readings + composite cost breakdown.
   * Computes rate = totalCost / totalUnits and sets calculatedAmount on each reading.
   * Re-running this will replace all readings for the period.
   */
  @Post('periods/:periodId/allocate')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Society-allocation: batch enter readings + allocate costs' })
  allocate(
    @SocietyId() societyId: string,
    @Param('periodId') periodId: string,
    @Body() dto: AllocateWaterCostsDto,
  ) {
    return this.waterService.allocatePeriodWaterCosts(societyId, {
      ...dto,
      billingPeriodId: periodId,
    });
  }

  @Get('periods/:periodId/summary')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Get water billing summary for a billing period' })
  periodSummary(
    @SocietyId() societyId: string,
    @Param('periodId') periodId: string,
  ) {
    return this.waterService.getPeriodWaterSummary(societyId, periodId);
  }
}
