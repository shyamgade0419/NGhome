import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { AdvanceCreditsService } from './advance-credits.service';
import { RefundAdvanceDto } from './dto/refund-advance.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('billing/advance-credits')
export class AdvanceCreditsController {
  constructor(private readonly service: AdvanceCreditsService) {}

  @Get()
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Flats that hold an advance, and how much' })
  list(@SocietyId() societyId: string) {
    return this.service.list(societyId);
  }

  @Post('refund')
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Admin only: pay a flat’s advance back, out of an account, with a reason' })
  refund(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: RefundAdvanceDto) {
    return this.service.refund(societyId, user.id, dto);
  }
}
