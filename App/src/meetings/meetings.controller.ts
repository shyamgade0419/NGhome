import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { MeetingsService, CreateMeetingDto } from './meetings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Meetings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.COMMITTEE_MEMBER)
  @ApiOperation({ summary: 'Create a meeting' })
  create(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMeetingDto,
  ) {
    return this.meetingsService.create(societyId, user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List meetings' })
  findAll(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.meetingsService.findAll(societyId, +page, +limit, user.currentRole === 'RESIDENT');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get meeting details' })
  findOne(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.meetingsService.findOne(societyId, id, user.currentRole === 'RESIDENT');
  }

  @Post(':id/minutes')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.COMMITTEE_MEMBER)
  @ApiOperation({ summary: 'Add/update meeting minutes' })
  addMinutes(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @Body() body: { content: string; summary?: string },
  ) {
    return this.meetingsService.addMinutes(societyId, id, body.content, body.summary);
  }

  @Post(':id/publish')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN)
  @ApiOperation({ summary: 'Publish meeting minutes' })
  publishMinutes(@SocietyId() societyId: string, @Param('id') id: string) {
    return this.meetingsService.publishMinutes(societyId, id);
  }

  @Post(':id/attendees')
  @UseGuards(RolesGuard)
  @Roles(SystemRole.SOCIETY_ADMIN, SystemRole.COMMITTEE_MEMBER)
  @ApiOperation({ summary: 'Record meeting attendees' })
  addAttendees(
    @SocietyId() societyId: string,
    @Param('id') id: string,
    @Body() body: { attendees: { name: string; flatCode?: string; role?: string }[] },
  ) {
    return this.meetingsService.addAttendees(societyId, id, body.attendees);
  }
}
