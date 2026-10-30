import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SystemRole } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { AssignRosterDto, ClearRosterDto, CreateShiftDto, MarkAttendanceDto, MarkDayDto, UpdateShiftDto } from './dto/attendance.dto';
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

const need = (value: string | undefined, name: string): string => {
  if (!value) throw new BadRequestException(`${name} is required.`);
  return value;
};

// ─── Committee: shifts, roster and attendance ────────────────────────────────

@ApiTags('Staff attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...COMMITTEE)
@Controller('staff-shifts')
export class StaffShiftsController {
  constructor(private readonly service: AttendanceService) {}

  @Get()
  @ApiOperation({ summary: 'The society shifts' })
  list(@SocietyId() societyId: string) {
    return this.service.listShifts(societyId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a shift, e.g. Morning 06:00-14:00' })
  create(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateShiftDto) {
    return this.service.createShift(societyId, user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change a shift, or retire it (active: false)' })
  update(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateShiftDto) {
    return this.service.updateShift(societyId, user, id, dto);
  }
}

@ApiTags('Staff attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...COMMITTEE)
@Controller('staff-roster')
export class StaffRosterController {
  constructor(private readonly service: AttendanceService) {}

  @Get()
  @ApiOperation({ summary: 'The duty roster for a range of dates' })
  @ApiQuery({ name: 'from', required: true, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'to', required: true, description: 'YYYY-MM-DD, at most 62 days' })
  roster(@SocietyId() societyId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.roster(societyId, need(from, 'from'), need(to, 'to'));
  }

  @Post('assign')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Put people on a shift (or a day off) for a range of dates' })
  assign(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: AssignRosterDto) {
    return this.service.assign(societyId, user, dto);
  }

  @Post('clear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear the roster for people over a range of dates' })
  clear(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: ClearRosterDto) {
    return this.service.clearRoster(societyId, user, dto);
  }
}

@ApiTags('Staff attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...COMMITTEE)
@Controller('staff-attendance')
export class StaffAttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @Get('staff')
  @ApiOperation({ summary: 'Active staff who can be rostered (names and designations only, no pay details)' })
  staff(@SocietyId() societyId: string) {
    return this.service.staff(societyId);
  }

  @Get('day')
  @ApiOperation({ summary: "Everyone's day: planned shift and what was recorded" })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD, default today (India time)' })
  day(@SocietyId() societyId: string, @Query('date') date?: string) {
    return this.service.day(societyId, date);
  }

  @Post('mark')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Record or correct one person's day" })
  mark(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: MarkAttendanceDto) {
    return this.service.mark(societyId, user, dto);
  }

  @Post('mark-day')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Mark many people for one date at once (status only)' })
  markDay(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: MarkDayDto) {
    return this.service.markDay(societyId, user, dto);
  }

  @Get('summary')
  @ApiOperation({ summary: "A month's counts for every employee" })
  @ApiQuery({ name: 'month', required: true, description: 'YYYY-MM' })
  summary(@SocietyId() societyId: string, @Query('month') month?: string) {
    return this.service.summary(societyId, need(month, 'month'));
  }

  @Get('employee/:id')
  @ApiOperation({ summary: "One person's month, day by day" })
  @ApiQuery({ name: 'month', required: true, description: 'YYYY-MM' })
  employee(@SocietyId() societyId: string, @Param('id') id: string, @Query('month') month?: string) {
    return this.service.employeeMonth(societyId, id, need(month, 'month'));
  }
}

// ─── Gate ────────────────────────────────────────────────────────────────────

@ApiTags('Gate')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...GATE)
@Controller('gate')
export class GateStaffController {
  constructor(private readonly service: AttendanceService) {}

  @Get('staff')
  @ApiOperation({ summary: "Today's staff and whether each is in (names, posts and shifts only)" })
  list(@SocietyId() societyId: string) {
    return this.service.gateStaff(societyId);
  }

  @Post('staff/:id/check-in')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Check a member of staff in for today (safe to repeat)' })
  checkIn(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.checkIn(societyId, user, id);
  }

  @Post('staff/:id/check-out')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Record a member of staff leaving (safe to repeat)' })
  checkOut(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.checkOut(societyId, user, id);
  }
}
