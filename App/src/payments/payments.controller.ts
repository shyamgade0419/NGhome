import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SystemRole, PaymentStatus } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { SubmitPaymentDto } from './dto/submit-payment.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({ summary: 'Resident: Submit payment confirmation' })
  submit(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitPaymentDto,
  ) {
    if (!user.flatId) throw new Error('No flat associated with account');
    return this.paymentsService.submit(societyId, user.id, user.flatId, dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Admin: List all payment submissions' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false, enum: PaymentStatus })
  findAll(
    @SocietyId() societyId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: PaymentStatus,
  ) {
    return this.paymentsService.findAll(societyId, +page, +limit, status);
  }

  @Get('my')
  @ApiOperation({ summary: 'Resident: Get own payment history' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  findMyPayments(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.paymentsService.findMyPayments(societyId, user.id, +page, +limit);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Admin: Get payment by ID' })
  findOne(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.paymentsService.findOne(societyId, id);
  }

  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Admin: Approve a payment submission' })
  approve(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { accountId: string; notes?: string },
  ) {
    return this.paymentsService.approve(societyId, id, user.id, body.accountId, body.notes);
  }

  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Admin: Reject a payment submission' })
  reject(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { reason: string },
  ) {
    return this.paymentsService.reject(societyId, id, user.id, body.reason);
  }
}
