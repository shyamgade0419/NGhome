import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { OpeningBalancesService } from './opening-balances.service';
import { CorrectOpeningBalanceDto, SaveOpeningBalancesDto } from './dto/opening-balances.dto';
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
@Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
@Controller('billing/opening-balances')
export class OpeningBalancesController {
  constructor(private readonly service: OpeningBalancesService) {}

  @Get()
  @ApiOperation({ summary: 'Every flat with the dues it carried over from before NG Home, and whether each can still be changed' })
  list(@SocietyId() societyId: string) {
    return this.service.list(societyId);
  }

  @Post()
  @ApiOperation({
    summary:
      'Save opening balances (what each flat owed on paper or Excel). dryRun checks without saving; an amount of 0 removes a balance nobody has paid against.',
  })
  save(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: SaveOpeningBalancesDto) {
    return this.service.save(societyId, user.id, dto);
  }

  @Post(':flatId/correct')
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({
    summary:
      'Admin only: correct an opening balance after a payment was made against it. Paid money above the new amount becomes the flat’s advance; the reason is audited.',
  })
  correct(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('flatId') flatId: string,
    @Body() dto: CorrectOpeningBalanceDto,
  ) {
    return this.service.correct(societyId, user.id, flatId, dto);
  }
}
