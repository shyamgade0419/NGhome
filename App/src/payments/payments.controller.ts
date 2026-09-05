import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, UseInterceptors,
  UploadedFile, Res, StreamableFile, HttpCode, HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { SystemRole, PaymentStatus } from '@prisma/client';
import type { Response } from 'express';
import { PaymentsService } from './payments.service';
import { SubmitPaymentDto } from './dto/submit-payment.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

const REVIEWER_ROLES: SystemRole[] = [SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT];

@ApiTags('Payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('proof', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Resident: Submit payment confirmation, optionally with a receipt/screenshot' })
  submit(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitPaymentDto,
    @UploadedFile() proof?: Express.Multer.File,
  ) {
    if (!user.flatId) throw new Error('No flat associated with account');
    return this.paymentsService.submit(societyId, user.id, user.flatId, dto, proof);
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

  // No @Roles here, deliberately — the resident who submitted this payment
  // needs to see their own receipt back too, not just the reviewer. The
  // service checks ownership OR reviewer role directly against this
  // specific payment (see getProofFile), which @Roles can't express.
  @Get(':id/proof')
  @ApiOperation({ summary: 'Download the receipt/screenshot attached to a payment submission' })
  async getProof(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, fileName, mimeType } = await this.paymentsService.getProofFile(societyId, id, {
      id: user.id,
      isReviewer: REVIEWER_ROLES.includes(user.currentRole as SystemRole),
    });
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
    });
    return new StreamableFile(buffer);
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
