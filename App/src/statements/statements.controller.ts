import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { StatementsService } from './statements.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Monthly Statements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('statements')
export class StatementsController {
  constructor(private readonly statementsService: StatementsService) {}

  @Post('generate/:periodId')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.SOCIETY_ACCOUNTANT)
  @ApiOperation({ summary: 'Generate monthly statement for a billing period' })
  generate(
    @SocietyId() societyId: string,
    @Param('periodId') periodId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.statementsService.generateStatement(societyId, periodId, user.id);
  }

  @Post(':id/publish')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Publish statement to residents' })
  publish(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.statementsService.publish(societyId, id, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List statements' })
  findAll(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.statementsService.findAll(societyId, user.currentRole === 'RESIDENT');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get statement by ID' })
  findOne(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.statementsService.findOne(societyId, id, user.currentRole === 'RESIDENT');
  }
}
