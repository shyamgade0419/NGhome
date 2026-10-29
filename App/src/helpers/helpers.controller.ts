import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { HelperStatus, SystemRole } from '@prisma/client';
import { HelpersService } from './helpers.service';
import { AddHelperDto, HelperCheckInDto, HelperCodeDto, SuspendHelperDto } from './dto/helper.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

const COMMITTEE = [SystemRole.SOCIETY_ADMIN, SystemRole.COMMITTEE_MEMBER] as const;
/** Who may work the gate. The committee is included so a society without a guard can still use it. */
const GATE = [SystemRole.SECURITY_GUARD, SystemRole.SOCIETY_ADMIN, SystemRole.COMMITTEE_MEMBER] as const;

function parseStatus(value: string | undefined): HelperStatus | undefined {
  if (value === undefined || value === '') return undefined;
  if (!Object.values(HelperStatus).includes(value as HelperStatus)) throw new BadRequestException('status is not a valid value.');
  return value as HelperStatus;
}

function parsePositiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException(`${name} must be a positive whole number.`);
  return n;
}

// ─── Resident: my household's help; committee: the register ──────────────────

@ApiTags('Household help')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('domestic-helpers')
export class HelpersController {
  constructor(private readonly service: HelpersService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Add someone who works in my home. A new person gets a pass code, shown once.' })
  add(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: AddHelperDto) {
    return this.service.addHelper(societyId, user, dto);
  }

  @Get('my')
  @ApiOperation({ summary: "My flat's household help" })
  mine(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.myHelpers(societyId, user);
  }

  @Get()
  @Roles(...COMMITTEE)
  @ApiOperation({ summary: 'The society register of household help' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  register(
    @SocietyId() societyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.service.adminList(societyId, {
      page: parsePositiveInt(page, 'page'),
      limit: Math.min(parsePositiveInt(limit, 'limit') ?? 25, 100),
      status: parseStatus(status),
      search,
    });
  }

  @Post(':id/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take someone off my flat’s list (their history is kept)' })
  remove(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.removeHelper(societyId, user, id);
  }

  @Post(':id/new-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Make a new pass code; the old one stops working. Shown once.' })
  newCode(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.newCode(societyId, user, id);
  }

  @Get(':id/visits')
  @ApiOperation({ summary: 'Recent visits of someone on my flat’s list' })
  visits(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.helperVisits(societyId, user, id);
  }

  @Post(':id/verify')
  @Roles(...COMMITTEE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record that the committee confirmed who this person is' })
  verify(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.verify(societyId, user, id);
  }

  @Post(':id/suspend')
  @Roles(...COMMITTEE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop the gate letting this person in, with a reason' })
  suspend(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SuspendHelperDto) {
    return this.service.suspend(societyId, user, id, dto);
  }

  @Post(':id/reinstate')
  @Roles(...COMMITTEE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Let a suspended person in again' })
  reinstate(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.reinstate(societyId, user, id);
  }
}

// ─── Committee: attendance log ───────────────────────────────────────────────

@ApiTags('Household help')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...COMMITTEE)
@Controller('domestic-helper-visits')
export class HelperVisitsController {
  constructor(private readonly service: HelpersService) {}

  @Get()
  @ApiOperation({ summary: 'Attendance log with filters' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD (India time)' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD (India time), inclusive' })
  @ApiQuery({ name: 'helperId', required: false })
  @ApiQuery({ name: 'search', required: false })
  log(
    @SocietyId() societyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('helperId') helperId?: string,
    @Query('search') search?: string,
  ) {
    return this.service.adminVisits(societyId, {
      page: parsePositiveInt(page, 'page'),
      limit: Math.min(parsePositiveInt(limit, 'limit') ?? 25, 100),
      from,
      to,
      helperId,
      search,
    });
  }
}

// ─── Gate ────────────────────────────────────────────────────────────────────

@ApiTags('Gate')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...GATE)
@Controller('gate')
export class GateHelpersController {
  constructor(private readonly service: HelpersService) {}

  @Get('helpers')
  @ApiOperation({ summary: 'Household help the guard can let in (names and flat numbers only)' })
  @ApiQuery({ name: 'search', required: false })
  helpers(@SocietyId() societyId: string, @Query('search') search?: string) {
    return this.service.gateHelpers(societyId, search);
  }

  @Get('helper-visits')
  @ApiOperation({ summary: 'Household help inside now, and everyone who came today' })
  visits(@SocietyId() societyId: string) {
    return this.service.gateVisits(societyId);
  }

  // Strict: like the visitor code, this is the one place a helper's pass code can be tried.
  @Post('helpers/scan')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Let someone in with their pass code' })
  scan(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: HelperCodeDto) {
    return this.service.checkInByCode(societyId, user, dto);
  }

  @Post('helpers/:id/check-in')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Let someone in who the guard picked from the list (safe to retry with the same clientRequestId)' })
  checkIn(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: HelperCheckInDto) {
    return this.service.checkInById(societyId, user, id, dto.clientRequestId);
  }

  @Post('helper-visits/:id/check-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record someone leaving' })
  checkOut(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.checkOut(societyId, user, id);
  }
}
