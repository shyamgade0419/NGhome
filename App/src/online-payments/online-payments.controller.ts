import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { SystemRole } from '@prisma/client';
import type { Response } from 'express';
import { OnlinePaymentsService } from './online-payments.service';
import { renderReturnHtml } from './return-page';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';

class SaveGatewayDto {
  @IsString()
  @Matches(/^rzp_(test|live)_[A-Za-z0-9]{8,32}$/, { message: 'The Key ID looks like rzp_live_… or rzp_test_…' })
  keyId: string;

  /** Blank keeps the saved secret. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keySecret?: string;

  @IsUUID()
  settlementAccountId: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class StartPaymentDto {
  @IsUUID()
  maintenanceBillId: string;

  /** Rupees, up to two decimals. */
  @IsNumberString({ no_symbols: false })
  @MinLength(1)
  @MaxLength(12)
  amount: string;
}

/**
 * Online payments through the society's own Razorpay account. Every route works on the society in the caller's token.
 * Only the admin connects the account; a resident can start and follow payments for their own flat's bills only.
 */
@ApiTags('Online payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('online-payments')
export class OnlinePaymentsController {
  constructor(private readonly online: OnlinePaymentsService) {}

  @Get('config')
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Admin: the society\'s Razorpay connection (never the secret)' })
  config(@SocietyId() societyId: string) {
    return this.online.view(societyId);
  }

  @Put('config')
  @Roles(SystemRole.SOCIETY_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Admin: connect (or update) the society\'s own Razorpay account; the keys are checked with Razorpay first' })
  save(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: SaveGatewayDto) {
    return this.online.save(societyId, dto, user.id);
  }

  @Delete('config')
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Admin: forget the Razorpay keys' })
  disconnect(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.online.disconnect(societyId, user.id);
  }

  @Get('recent')
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Admin: the latest payments started from the app, and how each went' })
  recent(@SocietyId() societyId: string, @Query('take') take?: string) {
    return this.online.recent(societyId, take ? Number(take) || 15 : 15);
  }

  @Get('available')
  @ApiOperation({ summary: 'Whether residents are offered "Pay online"' })
  available(@SocietyId() societyId: string) {
    return this.online.available(societyId);
  }

  @Post('start')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @ApiOperation({ summary: 'Resident: start an online payment for one of their bills; returns the Razorpay page to open' })
  start(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: StartPaymentDto) {
    return this.online.start(societyId, user.id, dto);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Resident: where one of their online payments stands (reads Razorpay if still open)' })
  status(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.online.statusOf(societyId, user.id, id);
  }
}

/** The page Razorpay sends a person back to after they pay. No login: it acts only on a callback signed with the society's own secret. */
@ApiExcludeController()
@Controller('public/online-payments')
export class OnlinePaymentsReturnController {
  constructor(private readonly online: OnlinePaymentsService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('return')
  async back(@Query() query: Record<string, string>, @Res() res: Response): Promise<void> {
    const result = await this.online.handleReturn(query);
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.status(200).send(renderReturnHtml(result.outcome, result.amount));
  }
}
