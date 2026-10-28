import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SystemRole, VisitorEntryStatus, VisitorType } from '@prisma/client';
import { VisitorsService } from './visitors.service';
import { CreateInvitationDto, DecisionDto, OverrideDto, ScanCodeDto, UpdateVisitorPolicyDto, WalkInDto } from './dto/visitor.dto';
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

function parseEnum<T extends string>(value: string | undefined, allowed: Record<string, T>, name: string): T | undefined {
  if (value === undefined || value === '') return undefined;
  if (!Object.values(allowed).includes(value as T)) throw new BadRequestException(`${name} is not a valid value.`);
  return value as T;
}

function parsePositiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException(`${name} must be a positive whole number.`);
  return n;
}

// ─── Resident: invitations ───────────────────────────────────────────────────

@ApiTags('Visitors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('visitor-invitations')
export class VisitorInvitationsController {
  constructor(private readonly service: VisitorsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Invite a guest. The code is returned once and never again.' })
  create(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInvitationDto) {
    return this.service.createInvitation(societyId, user, dto);
  }

  @Get('my')
  @ApiOperation({ summary: "My flat's invitations" })
  mine(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.myInvitations(societyId, user);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an invitation made from my flat' })
  revoke(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.revokeInvitation(societyId, user, id);
  }
}

// ─── Resident answers; committee reviews ─────────────────────────────────────

@ApiTags('Visitors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('visitors')
export class VisitorsController {
  constructor(private readonly service: VisitorsService) {}

  @Get('my')
  @ApiOperation({ summary: "Visitors for my flat, newest first" })
  @ApiQuery({ name: 'status', required: false })
  mine(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.service.myVisitors(societyId, user, parseEnum(status, VisitorEntryStatus, 'status'));
  }

  @Get('policy')
  @ApiOperation({ summary: "The society's visitor rules (readable by every member)" })
  policy(@SocietyId() societyId: string) {
    return this.service.getPolicy(societyId);
  }

  @Put('policy')
  @Roles(...COMMITTEE)
  @ApiOperation({ summary: 'Change the visitor rules' })
  updatePolicy(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateVisitorPolicyDto) {
    return this.service.updatePolicy(societyId, dto, user.id);
  }

  @Get()
  @Roles(...COMMITTEE)
  @ApiOperation({ summary: 'Gate log with filters' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD (India time)' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD (India time), inclusive' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'visitorType', required: false })
  @ApiQuery({ name: 'flatId', required: false })
  @ApiQuery({ name: 'search', required: false })
  log(
    @SocietyId() societyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('visitorType') visitorType?: string,
    @Query('flatId') flatId?: string,
    @Query('search') search?: string,
  ) {
    return this.service.adminLog(societyId, {
      page: parsePositiveInt(page, 'page'),
      limit: Math.min(parsePositiveInt(limit, 'limit') ?? 25, 100),
      from,
      to,
      status: parseEnum(status, VisitorEntryStatus, 'status'),
      visitorType: parseEnum(visitorType, VisitorType, 'visitorType'),
      flatId,
      search,
    });
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a visitor at my flat' })
  approve(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.service.decide(societyId, user, id, true, dto.note);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline a visitor at my flat' })
  reject(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.service.decide(societyId, user, id, false, dto.note);
  }

  @Post(':id/override')
  @Roles(...COMMITTEE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Committee decides an unanswered or expired request, with a reason' })
  override(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: OverrideDto) {
    return this.service.override(societyId, user, id, dto);
  }
}

// ─── Gate ────────────────────────────────────────────────────────────────────

@ApiTags('Gate')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...GATE)
@Controller('gate')
export class GateController {
  constructor(private readonly service: VisitorsService) {}

  @Get('flats')
  @ApiOperation({ summary: 'Flats the guard can pick as a destination (no resident names)' })
  @ApiQuery({ name: 'search', required: false })
  flats(@SocietyId() societyId: string, @Query('search') search?: string) {
    return this.service.lookupFlats(societyId, search);
  }

  @Post('walk-ins')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a visitor who arrived without an invitation (safe to retry with the same clientRequestId)' })
  walkIn(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: WalkInDto) {
    return this.service.registerWalkIn(societyId, user, dto);
  }

  // Strict: this endpoint is the only place a code can be tried, so it is the one to protect from guessing.
  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Check an invitation code and admit the visitor' })
  scan(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: ScanCodeDto) {
    return this.service.scanCode(societyId, user, dto);
  }

  @Get('visitors')
  @ApiOperation({ summary: "Today's visitors and anyone still open" })
  @ApiQuery({ name: 'search', required: false })
  list(@SocietyId() societyId: string, @Query('search') search?: string) {
    return this.service.gateList(societyId, search);
  }

  @Post('visitors/:id/check-in')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Let an approved visitor in' })
  checkIn(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.checkIn(societyId, user, id);
  }

  @Post('visitors/:id/check-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a visitor leaving' })
  checkOut(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.checkOut(societyId, user, id);
  }
}
