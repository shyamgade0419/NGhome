import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { SocietiesService } from './societies.service';
import { CreateSocietyDto } from './dto/create-society.dto';
import { UpdateSocietyConfigDto } from './dto/update-society-config.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PlatformAdminGuard } from '../common/guards/platform-admin.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Societies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('societies')
export class SocietiesController {
  constructor(private readonly societiesService: SocietiesService) {}

  @Post()
  @UseGuards(PlatformAdminGuard)
  @ApiOperation({ summary: '[Platform Admin] Create a new society' })
  async create(@Body() dto: CreateSocietyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.societiesService.create(dto, user.id);
  }

  @Get()
  @UseGuards(PlatformAdminGuard)
  @ApiOperation({ summary: '[Platform Admin] List all societies' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.societiesService.findAll(+page, +limit);
  }

  @Get('my')
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: 'Get current society details' })
  async getMySociety(@SocietyId() societyId: string) {
    return this.societiesService.findOne(societyId);
  }

  @Get('my/stats')
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: 'Get current society statistics' })
  async getStats(@SocietyId() societyId: string) {
    return this.societiesService.getStats(societyId);
  }

  @Get('my/config')
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: 'Get society configuration' })
  async getConfig(@SocietyId() societyId: string) {
    return this.societiesService.getConfiguration(societyId);
  }

  /**
   * Any authenticated society member (residents included) — deliberately no
   * RolesGuard. Every figure is individually gated server-side by the
   * corresponding show*ToResidents flag, so a resident can never see more
   * than the admin has switched on no matter what the client sends.
   */
  @Get('my/financial-summary')
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: 'Resident-safe financial transparency summary (gated by society config)' })
  async getFinancialSummary(@SocietyId() societyId: string) {
    return this.societiesService.getResidentFinancialSummary(societyId);
  }

  @Patch('my/config')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Update society configuration' })
  async updateConfig(@SocietyId() societyId: string, @Body() dto: UpdateSocietyConfigDto) {
    return this.societiesService.updateConfiguration(societyId, dto);
  }

  @Patch('my')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Update society details' })
  async update(@SocietyId() societyId: string, @Body() dto: Partial<CreateSocietyDto>) {
    return this.societiesService.update(societyId, dto);
  }

  @Get(':id')
  @UseGuards(PlatformAdminGuard)
  @ApiOperation({ summary: '[Platform Admin] Get society by ID' })
  async findOne(@Param('id') id: string) {
    return this.societiesService.findOne(id);
  }

  // ─── Join-code endpoints ────────────────────────────────────────────────────

  /**
   * Public — resolve a join code to the society's name + flat list.
   * No authentication required; the join code is the gate.
   * Used by the mobile app before the resident creates their account.
   */
  @Public()
  @Get('by-code/:code')
  @ApiOperation({
    summary: 'Look up a society by its invite/join code (public)',
    description:
      'Returns society name and the list of flats so the resident can pick theirs. ' +
      'No authentication required. The join code is the only gate for this endpoint.',
  })
  async findByJoinCode(@Param('code') code: string) {
    return this.societiesService.findByJoinCode(code);
  }

  /**
   * Admin — view the current join code for their society.
   * Generates one on the fly for societies created before this feature.
   */
  @Get('my/join-code')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Get the current society join/invite code (admin only)' })
  async getJoinCode(@SocietyId() societyId: string) {
    return this.societiesService.getJoinCode(societyId);
  }

  /**
   * Admin — rotate the join code. Old code is immediately invalidated.
   * Existing members are unaffected.
   */
  @Patch('my/regenerate-join-code')
  @UseGuards(TenantGuard, RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate the society join code (admin only)' })
  async regenerateJoinCode(@SocietyId() societyId: string) {
    return this.societiesService.regenerateJoinCode(societyId);
  }
}
