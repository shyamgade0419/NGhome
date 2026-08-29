import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { BillingService } from './billing.service';
import { CreateBillingPeriodDto } from './dto/create-billing-period.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  // ── Admin: Period management ──────────────────────────────────────────────

  @Post('periods')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Create a new billing period' })
  createPeriod(@SocietyId() societyId: string, @Body() dto: CreateBillingPeriodDto) {
    return this.billingService.createPeriod(societyId, dto);
  }

  @Get('periods')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOperation({ summary: 'List all billing periods' })
  findPeriods(
    @SocietyId() societyId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 12,
  ) {
    return this.billingService.findPeriods(societyId, +page, +limit);
  }

  @Get('periods/:periodId')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Get billing period by ID' })
  findPeriod(@SocietyId() societyId: string, @Param('periodId') periodId: string) {
    return this.billingService.findPeriod(societyId, periodId);
  }

  @Post('periods/:periodId/generate')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Generate/recalculate bills for a period' })
  generateBills(
    @SocietyId() societyId: string,
    @Param('periodId') periodId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billingService.generateBills(societyId, periodId, user.id);
  }

  @Post('periods/:periodId/publish')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Publish bills to residents' })
  publishPeriod(
    @SocietyId() societyId: string,
    @Param('periodId') periodId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billingService.publishPeriod(societyId, periodId, user.id);
  }

  @Post('periods/:periodId/close')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Close a billing period (admin only)' })
  closePeriod(
    @SocietyId() societyId: string,
    @Param('periodId') periodId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billingService.closePeriod(societyId, periodId, user.id);
  }

  @Get('periods/:periodId/report')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Get full period report with all bills + line items (for PDF download)' })
  getPeriodReport(@SocietyId() societyId: string, @Param('periodId') periodId: string) {
    return this.billingService.getPeriodReport(societyId, periodId);
  }

  @Get('periods/:periodId/bills')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOperation({ summary: 'List all bills in a period' })
  findBillsByPeriod(
    @SocietyId() societyId: string,
    @Param('periodId') periodId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    return this.billingService.findBillsByPeriod(societyId, periodId, +page, +limit);
  }

  @Get('bills/:billId')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Get a specific bill (admin)' })
  findBill(@SocietyId() societyId: string, @Param('billId') billId: string) {
    return this.billingService.findBillById(societyId, billId);
  }

  @Patch('bills/:billId/adjust')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Adjust a bill amount (before publishing)' })
  adjustBill(
    @SocietyId() societyId: string,
    @Param('billId') billId: string,
    @Body() body: { adjustment: number; note: string },
  ) {
    return this.billingService.adjustBill(societyId, billId, body.adjustment, body.note);
  }

  // ── Resident: View own bills ──────────────────────────────────────────────

  @Get('my-bills')
  @ApiOperation({ summary: 'Resident: Get own bills' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  findMyBills(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = 1,
    @Query('limit') limit = 12,
  ) {
    if (!user.flatId) return { data: [], meta: {} };
    return this.billingService.findMyBills(societyId, user.flatId, +page, +limit);
  }

  @Get('my-bills/:billId')
  @ApiOperation({ summary: 'Resident: Get a specific bill' })
  findMyBill(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('billId') billId: string,
  ) {
    return this.billingService.findBillById(societyId, billId, user.flatId);
  }
}
